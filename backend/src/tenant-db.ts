import { db } from "./db";

/** Models that carry a `companyId` and must never be read or written across tenants. */
const TENANT_MODELS: ReadonlySet<string> = new Set([
  "Job",
  "Candidate",
  "Application",
  "ActivityLog",
  "ScoringRun",
  "CompanyDomain",
]);

const WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
]);

const UPDATE_OPERATIONS: ReadonlySet<string> = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
]);

/**
 * A query that names a different tenant than the client it ran on. This is a
 * programming error, never user input, so it is deliberately not a
 * DomainError: adapters log it and show the generic failure.
 */
export class TenantViolationError extends Error {
  constructor(model: string, operation: string, detail: string) {
    super(`Tenant violation on ${model}.${operation}: ${detail}`);
    this.name = "TenantViolationError";
  }
}

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSameTenant(
  value: unknown,
  companyId: string,
  model: string,
  operation: string,
  field: string,
): void {
  if (value !== undefined && value !== companyId) {
    throw new TenantViolationError(model, operation, `${field}.companyId names another tenant`);
  }
}

function scopeWhere(where: unknown, companyId: string, model: string, operation: string): Args {
  const base = isRecord(where) ? where : {};
  assertSameTenant(base.companyId, companyId, model, operation, "where");
  return { ...base, companyId };
}

function scopeCreateData(data: unknown, companyId: string, model: string, operation: string): Args {
  const base = isRecord(data) ? data : {};
  if ("company" in base) {
    throw new TenantViolationError(model, operation, "set companyId, not the company relation");
  }
  assertSameTenant(base.companyId, companyId, model, operation, "data");
  return { ...base, companyId };
}

function guardUpdateData(data: unknown, companyId: string, model: string, operation: string): void {
  if (!isRecord(data)) return;
  if ("company" in data) {
    throw new TenantViolationError(model, operation, "rows cannot move between tenants");
  }
  assertSameTenant(data.companyId, companyId, model, operation, "data");
}

/** Pure so the rewrite rules are unit-testable without a database. */
export function scopeTenantArgs(
  model: string,
  operation: string,
  args: unknown,
  companyId: string,
): unknown {
  if (!TENANT_MODELS.has(model)) return args;
  const scoped: Args = isRecord(args) ? { ...args } : {};

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = scopeWhere(scoped.where, companyId, model, operation);
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    guardUpdateData(scoped.data, companyId, model, operation);
  }
  if (CREATE_OPERATIONS.has(operation)) {
    scoped.data = Array.isArray(scoped.data)
      ? scoped.data.map((row) => scopeCreateData(row, companyId, model, operation))
      : scopeCreateData(scoped.data, companyId, model, operation);
  }
  if (operation === "upsert") {
    scoped.create = scopeCreateData(scoped.create, companyId, model, operation);
    guardUpdateData(scoped.update, companyId, model, operation);
  }
  return scoped;
}

/**
 * A client whose top-level queries on tenant-owned models are pinned to one
 * company: filters get `companyId` injected, creates get it set, and any
 * query naming another tenant throws. It does not reach nested relation
 * writes or raw SQL — services still scope those explicitly — so it is a
 * backstop for the common path, not a replacement for scoping.
 */
export function forTenant(companyId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeTenantArgs(model, operation, args, companyId) as typeof args);
        },
      },
    },
  });
}

type ScopedClient = ReturnType<typeof forTenant>;

/**
 * The tenant client for single statements. `$transaction` is left off so
 * every transaction goes through `tenantTransaction`, which adds RLS.
 */
export type TenantDb = Omit<ScopedClient, "$transaction">;

export type TenantTx = Parameters<Parameters<ScopedClient["$transaction"]>[0]>[0];

const MAX_CACHED_TENANTS = 1_000;
const tenantClients = new Map<string, ScopedClient>();

function scopedClient(companyId: string): ScopedClient {
  const cached = tenantClients.get(companyId);
  if (cached) return cached;
  if (tenantClients.size >= MAX_CACHED_TENANTS) tenantClients.clear();
  const client = forTenant(companyId);
  tenantClients.set(companyId, client);
  return client;
}

/**
 * Memoised `forTenant`: services call this per query, so reuse the extended
 * client instead of rebuilding it. The cap keeps a long-lived process from
 * growing without bound across many tenants.
 */
export function tenantDb({ companyId }: { companyId: string }): TenantDb {
  return scopedClient(companyId);
}

/** The role the RLS policies bind; see the `tenant_row_level_security` migration. */
const TENANT_ROLE = "resumerank_tenant";

/**
 * Runs `fn` in one interactive transaction as the RLS-bound tenant role,
 * pinned to `companyId`, so Postgres enforces the tenant on everything inside
 * it — including the nested relation writes and raw SQL the extension can't
 * see. Both settings are transaction-local, so the pooled connection goes
 * back as the owner on commit or rollback.
 *
 * Single reads stay on `tenantDb`: wrapping each in a transaction would cost
 * extra round trips, and RLS stops non-leakproof search operators (ILIKE,
 * full-text match) using their GIN indexes.
 */
export function tenantTransaction<T>(
  { companyId }: { companyId: string },
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return scopedClient(companyId).$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('role', ${TENANT_ROLE}, true), set_config('app.company_id', ${companyId}, true)`;
    return fn(tx);
  });
}
