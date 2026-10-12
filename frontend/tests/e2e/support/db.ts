import { createHash, randomBytes } from "node:crypto";
import { Client } from "pg";

/** Every seeded account shares this password (see backend/prisma/seed.ts). */
export const SEED_PASSWORD = "demo1234";
export const DEMO_ADMIN = "demo@resumerank.app";
export const DEMO_VIEWER = "viewer@resumerank.app";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for e2e fixtures (same database the app uses).");
  return url;
}

/**
 * Runs `work` with a short-lived connection. Fixtures write straight to the
 * database for state the UI can't produce in a test (a second tenant, an
 * invite whose emailed token we know); everything under test still goes
 * through the app.
 */
export async function withDb<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export function uniqueTag(): string {
  return randomBytes(4).toString("hex");
}

function newId(): string {
  return `e2e${randomBytes(10).toString("hex")}`;
}

async function seededPasswordHash(client: Client): Promise<string> {
  const { rows } = await client.query<{ passwordHash: string }>(
    `SELECT "passwordHash" FROM "User" WHERE email = $1`,
    [DEMO_ADMIN],
  );
  const hash = rows[0]?.passwordHash;
  if (!hash) throw new Error("Seed the database first (npm run db:seed): the demo account is missing.");
  return hash;
}

export async function demoCompanyId(client: Client): Promise<string> {
  const { rows } = await client.query<{ companyId: string }>(
    `SELECT "companyId" FROM "User" WHERE email = $1`,
    [DEMO_ADMIN],
  );
  const id = rows[0]?.companyId;
  if (!id) throw new Error("Seed the database first (npm run db:seed): the demo account has no company.");
  return id;
}

export interface OtherTenant {
  companyId: string;
  email: string;
}

/** A second, empty workspace whose owner signs in with the seed password. */
export async function createOtherTenant(client: Client, tag: string): Promise<OtherTenant> {
  const companyId = newId();
  const email = `owner-${tag}@e2e.test`;
  await client.query(
    `INSERT INTO "Company" (id, name, slug, "updatedAt") VALUES ($1, $2, $3, now())`,
    [companyId, `Other Co ${tag}`, `other-co-${tag}`],
  );
  await joinCompany(client, await createUser(client, `Other Owner ${tag}`, email), companyId, "OWNER");
  return { companyId, email };
}

async function createUser(client: Client, name: string, email: string): Promise<string> {
  const id = newId();
  await client.query(
    `INSERT INTO "User" (id, name, email, "emailVerified", "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, now(), $4, now())`,
    [id, name, email, await seededPasswordHash(client)],
  );
  return id;
}

/** Adds an existing account to another company, as accepting an invite would. */
export async function joinCompany(
  client: Client,
  userId: string,
  companyId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
): Promise<void> {
  await client.query(
    `INSERT INTO "Membership" (id, "userId", "companyId", role, "updatedAt") VALUES ($1, $2, $3, $4, now())`,
    [newId(), userId, companyId, role],
  );
}

export async function userIdByEmail(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [email]);
  const id = rows[0]?.id;
  if (!id) throw new Error(`No user ${email}`);
  return id;
}

/** A member of `companyId` who signs in with the seed password. */
export async function addMember(client: Client, companyId: string, tag: string): Promise<string> {
  const email = `member-${tag}@e2e.test`;
  await joinCompany(client, await createUser(client, `Member ${tag}`, email), companyId, "MEMBER");
  return email;
}

/** Company deletion cascades its rows; its members' accounts are removed explicitly. */
export async function deleteTenant(client: Client, companyId: string): Promise<void> {
  await client.query(
    `DELETE FROM "User" WHERE id IN (SELECT "userId" FROM "Membership" WHERE "companyId" = $1)`,
    [companyId],
  );
  await client.query(`DELETE FROM "Company" WHERE id = $1`, [companyId]);
}

/** An invite into the demo workspace whose raw token is known, as if read from the email. */
export async function createDemoInvite(
  client: Client,
  email: string,
  role: "MEMBER" | "VIEWER",
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM "User" WHERE email = $1`,
    [DEMO_ADMIN],
  );
  await client.query(
    `INSERT INTO "CompanyInvite" (id, "companyId", email, role, "tokenHash", "invitedById", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 day')`,
    [newId(), await demoCompanyId(client), email, role, tokenHash, rows[0]?.id],
  );
  return token;
}

export async function deleteUsersByEmail(client: Client, emails: string[]): Promise<void> {
  await client.query(`DELETE FROM "CompanyInvite" WHERE email = ANY($1)`, [emails]);
  await client.query(`DELETE FROM "User" WHERE email = ANY($1)`, [emails]);
}
