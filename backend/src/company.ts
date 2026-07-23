import { db } from "./db";

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
