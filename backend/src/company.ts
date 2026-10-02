import { db } from "./db";
import { Prisma } from "./generated/prisma/client";

/**
 * Lowercases, replaces anything non-alphanumeric with a hyphen, and collapses
 * the result so slugs stay URL-safe and stable regardless of how a company
 * name is capitalized or punctuated.
 */
export function slugifyCompanyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "company";
}

/**
 * Appends -2, -3, ... until the slug is free. One query fetches every slug
 * sharing the base prefix, so collisions are resolved without a round trip
 * per attempt.
 */
export async function generateCompanySlug(name: string): Promise<string> {
  const base = slugifyCompanyName(name);
  const existing = await db.company.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  if (existing.length === 0) return base;

  const taken = new Set(existing.map((company) => company.slug));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

const SLUG_ATTEMPTS = 3;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Runs `create` with a freshly generated slug, retrying on a unique-constraint
 * conflict. Two concurrent signups for the same name can both see a slug as
 * free (reading inside the transaction doesn't prevent that under READ
 * COMMITTED), and one then fails on the unique index. A failed statement
 * aborts a Postgres transaction, so `create` should be the whole transaction:
 * the retry regenerates the slug, now seeing the competitor's committed row.
 */
export async function withUniqueCompanySlug<T>(
  name: string,
  create: (slug: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const slug = await generateCompanySlug(name);
    try {
      return await create(slug);
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= SLUG_ATTEMPTS) throw error;
    }
  }
}
