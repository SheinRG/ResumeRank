import { logActivity } from "../activity";
import { generateApiToken } from "../api/tokens";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { Prisma } from "../generated/prisma/client";
import { isApiScope, type ApiScope, type CreateApiKeyInput } from "../validators/api";
import { assertCanAdmin, type TenantContext } from "./context";
import { NotFoundError } from "./errors";

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: { id: string; name: string };
}

export interface CreatedApiKey {
  key: ApiKeyView;
  /** The full token, returned once; only its hash is stored. */
  token: string;
}

/** Revoked and expired keys stay listed this long, so the list shows what just stopped working. */
const SHOW_ENDED_FOR_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const API_KEY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  membership: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.ApiKeySelect;

type ApiKeyRow = Prisma.ApiKeyGetPayload<{ select: typeof API_KEY_SELECT }>;

function toView({ membership, scopes, ...key }: ApiKeyRow): ApiKeyView {
  return { ...key, scopes: scopes.filter(isApiScope), createdBy: membership.user };
}

export async function listApiKeys(ctx: TenantContext, now = new Date()): Promise<ApiKeyView[]> {
  assertCanAdmin(ctx);
  const cutoff = new Date(now.getTime() - SHOW_ENDED_FOR_MS);
  const rows = await tenantDb(ctx).apiKey.findMany({
    where: {
      companyId: ctx.companyId,
      AND: [
        { OR: [{ revokedAt: null }, { revokedAt: { gt: cutoff } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: cutoff } }] },
      ],
    },
    select: API_KEY_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toView);
}

/**
 * The key acts as the admin creating it, so it is created on their
 * membership: it can never do more than they can, and it goes when they do.
 */
export async function createApiKey(ctx: TenantContext, input: CreateApiKeyInput): Promise<CreatedApiKey> {
  assertCanAdmin(ctx);
  const { name, scopes, expiresInDays } = input;
  const generated = generateApiToken();

  return tenantTransaction(ctx, async (tx) => {
    const row = await tx.apiKey.create({
      data: {
        id: generated.id,
        companyId: ctx.companyId,
        createdById: ctx.actorId,
        name,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        scopes,
        expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY_MS),
      },
      select: API_KEY_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "api_key.create",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `created the API key "${name}"`,
        metadata: { keyId: row.id, scopes, expiresInDays },
      },
      tx,
    );
    return { key: toView(row), token: generated.token };
  });
}

export async function revokeApiKey(ctx: TenantContext, id: string): Promise<ApiKeyView> {
  assertCanAdmin(ctx);

  return tenantTransaction(ctx, async (tx) => {
    const { count } = await tx.apiKey.updateMany({
      where: { id, companyId: ctx.companyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const row = await tx.apiKey.findUnique({ where: { id, companyId: ctx.companyId }, select: API_KEY_SELECT });
    if (!row) throw new NotFoundError("That API key no longer exists.");
    if (count === 0) return toView(row);

    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "api_key.revoke",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `revoked the API key "${row.name}"`,
        metadata: { keyId: row.id },
      },
      tx,
    );
    return toView(row);
  });
}
