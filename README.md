# ResumeRank

ResumeRank scores every applicant against a job's actual requirements — with
quoted evidence and explicit gaps — so a recruiter can shortlist in under 60
seconds without trusting a black box. Create a job with a structured
requirement list, add candidates by pasting resume text, click **Score with
AI**, and get a weighted 0–100 score plus a requirement-by-requirement
breakdown: verdict, a verbatim quote from the resume, and a note explaining
the call.

ResumeRank is open source and built for many companies, not one. Register and
you get your own company workspace — your jobs, candidates, and applications,
isolated from every other company on the same instance. Invite your team by
email, and customize your company profile (logo, industry, size, location)
from Settings. Self-host it for your org, or run it as a shared instance where
each company that registers gets its own walled-off data.

## Features

- **Explainable AI scoring** — Groq returns a strict JSON contract, parsed by
  Zod, with one verdict (strong / partial / missing) per requirement, a
  resume-verified evidence quote, and a note. No partial or silent writes on
  malformed output.
- **Weighted rubric** — must-have requirements count twice as much as
  nice-to-haves; a partial verdict earns half credit.
- **Full applicant pipeline** — jobs, candidates, and applications move
  through new → screening → shortlisted → interview → offer → hired /
  rejected, with soft delete and undo.
- **Team scorecards** — teammates leave a 1–5 rating and notes alongside the
  AI's evaluation.
- **Multi-tenant workspaces** — every company's jobs, candidates,
  applications, and activity log are scoped to that company alone; a shared
  Postgres database backs any number of tenants with row-level isolation.
- **Company registration** — signing up creates your company and makes you
  its OWNER; there's no shared or first-user-wins workspace.
- **Email invites** — admins/owners invite teammates by email and role
  (admin / member / viewer) from Settings → Team; invitees accept at a
  tokenized `/invite` link. Google sign-ins with no company land on
  `/onboarding` to accept a pending invite or create a company.
- **Company settings** — HR (admin/owner) edits the company profile (name,
  logo, website, description, industry, size, location) from Settings →
  Company; members see it read-only.
- **Server-enforced RBAC** — owner / admin / member / viewer roles are
  re-checked from the database on every mutation; the client role is never
  trusted.
- **Immutable activity log** — every mutation is recorded and filterable by
  entity.
- **Dashboard** — pipeline funnel, score distribution, and application volume
  over time via recharts.
- **Search, filters, and CSV export** — server-side, debounced, mirrored into
  the URL.

## Tech stack

Next.js 16.2 (App Router, Turbopack) · React 19 · TypeScript (strict) · npm
workspaces (backend / frontend) · Tailwind CSS 4 · Prisma 7 (driver adapter,
Postgres) · Auth.js v5 (JWT sessions, Google OAuth) · Groq (LLM scoring) ·
Zod 4 · Vitest · Playwright · framer-motion · GSAP + Lenis (marketing motion) ·
recharts.

## Project layout

An npm-workspaces monorepo:

- **`backend/`** (`@resumerank/core`) — framework-agnostic domain: Prisma
  schema / migrations / generated client / seed, the `db` and `env` singletons,
  Zod validators, the scoring engine, auth helpers (including company invite
  tokens), company slug generation, email, rate limiting, the activity log,
  and shared types. No Next.js imports; ships raw TypeScript that Turbopack
  transpiles.
- **`frontend/`** — the Next.js App Router app: routes (including
  `/onboarding` and `/invite` for joining a company, and `/settings/company`
  for the company profile), UI, server actions and queries — every tenant-owned
  one scoped to the caller's company via `requireMember()` — the Auth.js config
  and guards, and the marketing site. Imports the backend as
  `@resumerank/core/*`.

Run every command from the repo root — the root scripts fan out to the right
workspace, and a single root `.env` feeds both.

## Quick start

```bash
git clone <this-repo>
cd resumerank
npm install   # installs both workspaces and generates the Prisma client

# Local Postgres via Docker (port 5433). POSTGRES_DB must match DATABASE_URL.
docker run --name resumerank-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=resumerank \
  -p 5433:5432 -d postgres:16

cp .env.example .env
# Fill in DATABASE_URL (point at the container above) and AUTH_SECRET
# (generate one with `openssl rand -base64 32` or `npx auth secret`).

npm run db:migrate
npm run db:seed
npm run dev -- -p 3005
```

Open `http://localhost:3005`. Sign in with the seeded demo account, which
lands you in the demo company "Acme Talent":

- **Email:** `demo@resumerank.app`
- **Password:** `demo1234`

AI scoring works out of the box against seeded data; to score new
applications yourself, add a free `GROQ_API_KEY` (see the env table below).

Registering a new account (`/register`) instead creates **your own** company
and makes you its owner — it's fully isolated from Acme Talent and from every
other company on the same instance. Teammates don't self-register into your
company; invite them by email from Settings → Team once you're signed in.

## Environment variables

Copy `.env.example` to `.env` (at the repo root — it feeds both workspaces).
Full contract and defaults live in `backend/src/env.ts`.

| Variable              | Required                    | Purpose                                                                              |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`        | Yes                          | Postgres connection string (Neon in production; Docker Postgres on 5433 in dev).     |
| `AUTH_SECRET`         | Yes                          | Session signing secret for Auth.js (JWT strategy). Min 16 chars.                     |
| `AUTH_URL`            | No (recommended in prod)     | Canonical app URL used for Auth.js OAuth callbacks.                                  |
| `AUTH_GOOGLE_ID`      | No                           | Google OAuth client id. The Google sign-in button hides itself when unset.           |
| `AUTH_GOOGLE_SECRET`  | No                           | Google OAuth client secret.                                                          |
| `GROQ_API_KEY`        | No (required for live scoring) | Groq API key. Without it, scoring returns a clear "not configured" message.       |
| `GROQ_MODEL`          | No (default provided)        | Groq model name. Defaults to `llama-3.3-70b-versatile`.                              |
| `RESEND_API_KEY`      | No                           | Resend API key. Without it, verification/reset links are logged to the server console. |
| `EMAIL_FROM`          | No (default provided)        | From address for transactional email.                                                |
| `NEXT_PUBLIC_APP_URL` | No (default provided)        | Public app URL, used for SEO metadata and links inside emails.                       |

## Scripts

| Script               | Purpose                                    |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Start the dev server (Turbopack).           |
| `npm run build`       | Production build.                           |
| `npm run start`       | Serve the production build.                 |
| `npm run lint`        | ESLint (flat config).                       |
| `npm run typecheck`   | `tsc --noEmit`.                             |
| `npm run test`        | Unit tests (Vitest, run once).              |
| `npm run test:watch`  | Unit tests in watch mode.                   |
| `npm run test:e2e`    | End-to-end tests (Playwright).              |
| `npm run db:generate` | Regenerate the Prisma client.               |
| `npm run db:migrate`  | Apply migrations in development.            |
| `npm run db:deploy`   | Apply migrations in production/CI.          |
| `npm run db:push`     | Push the schema without a migration file.   |
| `npm run db:seed`     | Seed a realistic demo workspace.            |
| `npm run db:studio`   | Open Prisma Studio.                         |

## Testing

- **Unit** (`backend/tests/unit`, Vitest): scoring math, LLM response parsing /
  reconciliation, validators, role capabilities, and the rate limiter — pure
  logic with no database or network dependency. `npm run test`.
- **End-to-end** (`frontend/tests/e2e`, Playwright): the golden path — sign in,
  reach the dashboard, and open a job's ranked applicant pipeline — against
  `http://localhost:3105`. Requires a **seeded** database (`npm run db:seed`).
  `npm run test:e2e` reuses an already-running server, otherwise it boots one.
  If the Turbopack dev server is flaky (seen on some Windows setups), serve a
  production build first — `npm run build && npm run start -- -p 3105` — then
  re-run `npm run test:e2e`.

## Deployment

Deploys to **Vercel**, backed by **Neon** Postgres (set `DATABASE_URL` to
Neon's pooled connection string). Set `AUTH_URL` and `NEXT_PUBLIC_APP_URL` to
the deployed domain, run `npm run db:deploy` against the production database
before first traffic, and configure `GROQ_API_KEY` / `RESEND_API_KEY` if you
want live scoring and email delivery rather than console fallbacks.

One deployment can serve many companies: the app is multi-tenant on a shared
database, so every company that registers gets its own isolated workspace on
the same instance — no per-tenant infrastructure to stand up. If you'd rather
not share an instance with other companies, self-host: each self-hoster gets
their own deployment and their own Postgres database, with the first company
to register on it as its only tenant.

## Screenshots

Screenshots live in [`docs/screenshots/`](docs/screenshots/) — not included
in this checkout yet.

## Further reading

- [`docs/plan.md`](docs/plan.md) — pitch, user stories, milestones, and the
  explicit assumptions this build made.
- [`docs/architecture.md`](docs/architecture.md) — how the app is put
  together: routing, server actions, RBAC, the scoring pipeline, rate
  limiting, and security headers.
- [`docs/case-study.md`](docs/case-study.md) — problem, approach, trade-offs,
  and what we'd do differently.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — local setup and PR conventions.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.
