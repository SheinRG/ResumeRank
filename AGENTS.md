<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ResumeRank — Engineering Conventions

ResumeRank is an applicant-tracking + AI resume-screening tool. Recruiters create Jobs with structured requirements, add Candidates (pasted resume text), and score each Application with an LLM that returns a per-requirement verdict (STRONG/PARTIAL/MISSING) with quoted evidence — explainable scoring is the differentiator. See `docs/plan.md` for milestones and acceptance criteria.

## Version gotchas — read before writing code

**Next.js 16.2 (App Router, Turbopack default).** Breaking changes vs. training data — full docs in `node_modules/next/dist/docs/`:
- `params`, `searchParams`, `cookies()`, `headers()` are ALL async (`await` them). Use `PageProps<'/route'>` / `LayoutProps` global helpers where handy.
- `src/proxy.ts` replaces `middleware.ts` (exists already; export named `proxy`, Node runtime).
- `next lint` is gone — run `npm run lint` (eslint flat config).

**Prisma 7.8.** Client is generated to `src/generated/prisma` (gitignored) — import `PrismaClient`/types from `@/generated/prisma/client`, enums from `@/generated/prisma/enums`. Never import `@prisma/client` directly. Connection config lives in `prisma.config.ts`; the client uses the `@prisma/adapter-pg` driver adapter (see `src/lib/db.ts` — always use the `db` singleton).

**Auth.js v5 beta (next-auth@beta).** `auth()`, `signIn`, `signOut`, `handlers` come from `@/lib/auth`. JWT session strategy. Session gives `user.id` and `user.role` for UI affordances only — authorization always re-checks the DB via guards.

**Zod 4** and **Tailwind CSS 4** (CSS-first config via `@theme` in `src/app/globals.css` — there is no tailwind.config file). **framer-motion 12**, **recharts 3**, **lucide-react**.

## Hard rules (the build is graded on these)

- TypeScript strict. No `any`, no non-null assertions where a narrow would do, no `@ts-ignore`.
- No TODO comments, no commented-out code, no dead files, no AI-attribution text anywhere.
- Comments explain *why*, never *what*; most code should need none.
- Every async view resolves to one of: loading (skeletons matching final layout), empty (with a CTA), error (named fix + retry), success. No blank flashes, no white screens.
- Validate with the shared Zod schemas from `@/lib/validators` on BOTH the client form and inside the server action. Never write a second ad-hoc validation.
- Every mutation: goes through a server action in `src/server/actions/`, starts with a guard (`requireWriter()` / `requireAdmin()` from `@/lib/auth/guards`), verifies row-level ownership where relevant, returns `ActionResult<T>` via `runAction()` (`@/server/run-action`), returns the mutated record, and logs to the activity log (`logActivity` in `@/server/activity`).
- Never trust a client-sent role or id claim; guards re-fetch the user from the DB.
- Secrets only via `env()` from `@/lib/env` (server-only). Nothing secret behind `NEXT_PUBLIC_`.

## Design system

- Spacing on the 4/8px scale only (Tailwind default steps). Type scale: 12/14/16/20/24/32/48. Body 16px lh-1.5.
- Radius: 8px default, 6px inputs, 12px cards/modals (`--radius` token).
- One accent (indigo), zinc neutrals, 3 grays max per surface. WCAG AA contrast (4.5:1 body, 3:1 large/UI).
- Dark mode via `next-themes` class strategy — design it, don't invert it (elevate surfaces with lighter zinc, desaturate accent).
- UI primitives live in `src/components/ui/` (shadcn-style: cva + Radix + `cn()` from `@/lib/utils`). Reuse them; never restyle one-off.
- Motion: framer-motion only on state change, 150–250ms ease-out, honor `useReducedMotion`. Shared wrappers in `src/components/motion.tsx`.
- Focus ring: 2px accent outline, 2px offset, `:focus-visible` only. Tap targets ≥44px. Keyboard operable everywhere; Cmd/Ctrl+K opens the command palette.
- Status color language: verdict STRONG=emerald, PARTIAL=amber, MISSING=rose. Stages: NEW=zinc, SCREENING=sky, SHORTLISTED=indigo, INTERVIEW=violet, OFFER=amber, HIRED=emerald, REJECTED=rose.

## Commands

- `npm run typecheck` · `npm run lint` · `npm run test` (vitest) · `npm run build`
- Dev server: `npm run dev -- -p 3005` (port 3000 is taken by another local project).
- Local DB: Postgres in Docker on port 5433 (see `.env`); `npm run db:migrate`, `npm run db:seed`. Demo login: `demo@resumerank.app` / `demo1234`.

## Structure

- `src/app/(marketing)` public pages · `src/app/(auth)` login/register/verify/reset · `src/app/(app)` the signed-in product (sidebar shell)
- `src/components/ui` primitives · `src/components/<feature>` feature components · `src/server/actions` mutations · `src/server/queries` reads · `src/lib` shared logic · `tests/` unit + e2e
