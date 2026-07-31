<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ResumeRank — Engineering Conventions

ResumeRank is a multi-tenant, open-source applicant-tracking + AI resume-screening tool. Each company gets its own isolated workspace (row-level tenancy on a shared Postgres): recruiters create Jobs with structured requirements, add Candidates (pasted resume text), and score each Application with an LLM that returns a per-requirement verdict (STRONG/PARTIAL/MISSING) with quoted evidence — explainable scoring is the differentiator. See `docs/plan.md` for milestones and acceptance criteria.

## Monorepo layout (npm workspaces)

Two workspaces at the repo root:
- **`backend/`** — the `@resumerank/core` package. Framework-agnostic domain code with **no Next.js imports**: Prisma (schema/migrations/generated client/seed), the `db` singleton, `env`, Zod `validators`, the `scoring` engine, `auth/{password,tokens}`, `email`, `rate-limit`, `activity`, and shared `types`. Internal imports are **relative**; it ships raw TypeScript and Turbopack transpiles it (`transpilePackages`).
- **`frontend/`** — the Next.js app. Routes, UI, and the Next-bound glue: `server/actions` + `server/queries` (both enforce auth via guards, so they stay here), `run-action`, the Auth.js config + `guards` (they call `auth()`), `proxy`, and `lib/{format,site,utils}`.

Backend modules are imported by name: `@resumerank/core/db`, `@resumerank/core/validators/job`, `@resumerank/core/scoring/engine`, etc. Frontend-internal modules keep the `@/*` alias. A single root `.env` feeds both workspaces (loaded via dotenv in `frontend/next.config.ts` and `backend/prisma.config.ts`).

## Version gotchas — read before writing code

**Next.js 16.2 (App Router, Turbopack default).** Breaking changes vs. training data — full docs in `node_modules/next/dist/docs/`:
- `params`, `searchParams`, `cookies()`, `headers()` are ALL async (`await` them). Use `PageProps<'/route'>` / `LayoutProps` global helpers where handy.
- `src/proxy.ts` replaces `middleware.ts` (exists already; export named `proxy`, Node runtime).
- `next lint` is gone — run `npm run lint` (eslint flat config).

**Prisma 7.8.** Client is generated to `backend/src/generated/prisma` (gitignored) — import `PrismaClient`/types from `@resumerank/core/generated/prisma/client`, enums from `@resumerank/core/generated/prisma/enums`. Never import `@prisma/client` directly. Connection config lives in `backend/prisma.config.ts`; the client uses the `@prisma/adapter-pg` driver adapter (see `backend/src/db.ts` — always use the `db` singleton).

**Auth.js v5 beta (next-auth@beta).** `auth()`, `signIn`, `signOut`, `handlers` come from `@/lib/auth` (frontend). JWT session strategy. Session gives `user.id` and `user.role` for UI affordances only — authorization always re-checks the DB via guards.

**Zod 4** and **Tailwind CSS 4** (CSS-first config via `@theme` in `frontend/src/app/globals.css` — there is no tailwind.config file). **framer-motion 12** (signed-in app) and **GSAP 3 + Lenis** (marketing page only), **recharts 3**, **lucide-react**.

## Hard rules (the build is graded on these)

- TypeScript strict. No `any`, no non-null assertions where a narrow would do, no `@ts-ignore`.
- No TODO comments, no commented-out code, no dead files, no AI-attribution text anywhere.
- Comments explain *why*, never *what*; most code should need none.
- Every async view resolves to one of: loading (skeletons matching final layout), empty (with a CTA), error (named fix + retry), success. No blank flashes, no white screens.
- Validate with the shared Zod schemas from `@resumerank/core/validators` on BOTH the client form and inside the server action. Never write a second ad-hoc validation.
- Every mutation: goes through a server action in `frontend/src/server/actions/`, starts with a guard (`requireWriter()` / `requireAdmin()` from `@/lib/auth/guards`), verifies row-level ownership where relevant, returns `ActionResult<T>` via `runAction()` (`@/server/run-action`), returns the mutated record, and logs to the activity log (`logActivity` from `@resumerank/core/activity`).
- Never trust a client-sent role or id claim; guards re-fetch the user from the DB.
- **Tenancy is not optional.** Every read or write on a tenant-owned model (`Job`, `Candidate`, `Application`, `ActivityLog`) goes through `requireMember()` (or `requireWriter()`/`requireAdmin()`, which both call it) and filters/scopes by that guard's `companyId` — never query one of these models without a company filter. Every create sets `companyId` from the guard, not from client input. `logActivity` requires a `companyId` on every call. Cross-tenant ids must behave as if they don't exist (404/not-found, never a leak).
- Secrets only via `env()` from `@resumerank/core/env` (server-only). Nothing secret behind `NEXT_PUBLIC_`.

## Design system

A two-tone **ink + lime** language. All tokens live in `frontend/src/app/globals.css` (`@theme`); style with the semantic utilities (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-accent`, `border-border`) — never hardcode a hex in a component.

- **Palette.** Warm cream surface (`#F6F4EE`) with white cards in light; near-black (`#0A0D14`) with `#12161F` cards in dark. Ink (`#161A21`) is the primary action color; lime (`#C6F24E`) is the single accent/highlight. Spacing stays on the 4/8px scale. WCAG AA contrast (4.5:1 body, 3:1 large/UI).
- **Type.** Body **Instrument Sans** 16px/1.5. Display is **Space Grotesk** on marketing (`font-display`) and **Montserrat** in the signed-in app (`font-display-app`). **JetBrains Mono** (`font-mono`) for labels, scores, IDs, and metadata. Type scale 12/14/16/20/24/32/48.
- **Radius.** Cards/modals `rounded-2xl`–`rounded-[20px]`, inputs `rounded-lg`, primary actions are pills (`rounded-full`). `--radius` token = 8px base.
- **Dark mode** via `next-themes` class strategy — design it, don't invert it (elevate surfaces, brighten the accent, don't just flip lightness).
- **UI primitives** live in `frontend/src/components/ui/` (shadcn-style: cva + Radix + `cn()` from `@/lib/utils`). Reuse them; never restyle one-off.
- **Motion.** framer-motion in the app (150–250ms ease-out, on state change, honor `useReducedMotion`; shared wrappers in `frontend/src/components/motion.tsx`). The marketing page uses **GSAP + Lenis** for scroll choreography (parallax, split-word reveals, pinned demo, magnetic buttons) — all gated on `prefers-reduced-motion`.
- **Focus ring:** 2px `--ring` outline, 2px offset, `:focus-visible` only. Tap targets ≥44px. Keyboard operable everywhere; Cmd/Ctrl+K opens the command palette.
- **Status color language** (semantic tokens): verdict `verdict-strong` (emerald), `verdict-partial` (amber), `verdict-missing` (rose). Stages `stage-{new,screening,shortlisted,interview,offer,hired,rejected}` = zinc / blue / gold / lime-green / teal / emerald / rose.

## Commands

Run from the repo root; the root scripts fan out to the right workspace.
- `npm run typecheck` (both workspaces) · `npm run lint` (frontend) · `npm run test` (backend vitest) · `npm run build` (generates the Prisma client, then builds the frontend).
- Dev server: `npm run dev -- -p 3005` (port 3000 is taken by another local project).
- Local DB: Postgres in Docker on port 5433 (see `.env`); `npm run db:migrate`, `npm run db:seed` (proxied to the backend workspace). Demo login: `demo@resumerank.app` / `demo1234`.
- Backend unit tests live in `backend/tests/unit`; frontend e2e (`npm run test:e2e`) uses Playwright.

## Structure

- **frontend** — `frontend/src/app/(marketing)` public pages · `frontend/src/app/(auth)` login/register/verify/reset, plus `/onboarding` (OAuth users with no company: accept a pending invite or create one) and `/invite` (accept an emailed invite token) · `frontend/src/app/(app)` the signed-in product (sidebar shell), including `settings/company` (company profile, admin/owner-editable) and `settings/team` (invite/revoke teammates). `frontend/src/components/ui` primitives · `frontend/src/components/<feature>` feature components · `frontend/src/server/actions` mutations · `frontend/src/server/queries` reads · `frontend/src/lib` Next-bound shared logic (`lib/auth/guards.ts` has `requireMember()` alongside `requireWriter`/`requireAdmin`).
- **backend** — `backend/src/{validators,scoring,auth,types}`, `backend/src/{db,env,email,rate-limit,activity,company}.ts` (`company.ts` slugifies/generates unique company slugs), `backend/prisma/` (schema — `Company`/`CompanyInvite` models, `companyId` on `User`/`Job`/`Candidate`/`Application`/`ActivityLog` — migrations, seed). Consumed as `@resumerank/core/*`.
