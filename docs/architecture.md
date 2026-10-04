# Architecture

This is an honest account of how ResumeRank is built, not an aspirational one
— every claim below points at the file that implements it.

## Routing: App Router with route groups

`src/app` splits into three route groups that share no layout chrome by
accident — each one is a distinct surface:

- `src/app/(marketing)` — the public site (`/`). Has its own layout
  (`layout.tsx`) with a sticky nav and footer, and its own
  `opengraph-image.tsx`. Nothing here requires a session.
- `src/app/(auth)` — login, register, verify, reset. Unauthenticated flows.
- `src/app/(app)` — the signed-in product behind a sidebar shell. Every page
  here assumes a session and re-checks it server-side (see RBAC below);
  route groups only organize layouts, they enforce nothing on their own.

Root-level files (`sitemap.ts`, `robots.ts`, `layout.tsx`) live outside all
three groups since they apply site-wide. `params` and `searchParams` are
promises throughout (Next.js 16 convention) — every page and metadata route
that reads them awaits first.

## Mutations: server actions + the `ActionResult` pattern

Every write goes through a `"use server"` function in `src/server/actions/`.
None of them throw at the boundary. The shape is fixed by
`src/types/action.ts`:

```ts
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
```

`src/server/run-action.ts` wraps the body of every action:

```ts
export function createJobAction(input: unknown) {
  return runAction("createJob", async () => { /* guard → service → revalidate */ });
}
```

A `GateError` (thrown by the auth guards below) or a service `DomainError`
becomes a clean, named message on the client. Anything else is logged
server-side and replaced with a generic message carrying a short reference
(the log line's `digest`) — the client never sees a raw stack trace. Every
call also writes one structured `action` log line; see Observability. A typical action
(`src/server/actions/jobs.ts::createJobAction`) follows the same shape every
time: parse with a shared Zod schema, run a guard, do the write, call
`logActivity`, `revalidatePath` the affected routes, and return the mutated
record via `actionOk`.

## Guards and RBAC

`src/lib/auth/guards.ts` exports `requireUser`, `requireWriter`, and
`requireAdmin`. All three re-fetch the user from the database on every call:

```ts
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new GateError("You need to sign in to do that.");
  const user = await db.user.findUnique({ where: { id }, select: { ... } });
  if (!user) throw new GateError("Your account no longer exists.");
  return user;
}
```

The session JWT carries `user.id` and `user.role` (set in
`src/lib/auth/index.ts`'s `jwt`/`session` callbacks), but that role is only
ever used for UI affordances — showing or hiding a button. Authorization
itself is decided by the fresh database row, so a role downgrade takes effect
on the very next request instead of waiting for the JWT to expire.
`requireMember` additionally requires the fresh row to have a `companyId`
(narrowing the return type to `CompanyUser`, where `companyId` is non-null) —
`requireWriter` and `requireAdmin` both call it first, so every write path
already has a company to scope to before it checks verification or role.
`requireWriter` additionally rejects unverified emails and viewer role;
`requireAdmin` layers an owner/admin check on top. No action trusts a
client-sent role or id.

## Multi-tenancy

ResumeRank runs many companies on one shared Postgres database, isolated by
row-level `companyId` scoping rather than a database- or schema-per-tenant
split. `Job`, `Candidate`, `Application`, and `ActivityLog` all carry a
required `companyId`; `Candidate.email` is unique per company
(`@@unique([companyId, email])`), not globally, so two different companies
can each have their own candidate at the same address. `User.companyId` is
the one nullable exception — an OAuth sign-up exists before it has a company.

**Enforcement lives in the guards, not in ad-hoc `where` clauses scattered
through the app.** `requireMember()` (`frontend/src/lib/auth/guards.ts`)
re-fetches the user from the database on every call and throws unless
`companyId` is set, returning a `CompanyUser` whose `companyId` is
guaranteed non-null. Every query in `frontend/src/server/queries/` and every
action in `frontend/src/server/actions/` calls `requireMember()` (directly,
or transitively via `requireWriter`/`requireAdmin`) and threads its
`companyId` into the Prisma call — as a `where: { companyId, ... }` filter on
reads, and as the `companyId` field on every `create`. `logActivity`
(`backend/src/activity.ts`) takes `companyId` as a required field, so an
activity entry can't be written without one. Because every lookup is scoped
this way, an id belonging to another company simply doesn't match the query
and behaves as if it doesn't exist — there is no separate "is this mine?"
check to forget.

**Membership lifecycle.** There are three ways to end up with a `companyId`:

1. **Register** (`/register`, `registerAction` in
   `frontend/src/server/actions/auth.ts`) — creates a `Company` (slug via
   `generateCompanySlug`, `backend/src/company.ts`) and the calling user as
   its `OWNER` in one transaction. Registering never joins an existing
   company; there is no first-user-becomes-owner shared workspace.
2. **Invite → accept** — an admin/owner invites by email + role from
   `/settings/team` (`inviteMemberAction`, `frontend/src/server/actions/company.ts`),
   which mints a hashed, expiring token (`createCompanyInvite`,
   `backend/src/auth/tokens.ts`) and emails a link to `/invite?token=...`.
   That route (`frontend/src/app/(auth)/invite/page.tsx`) branches on whether
   the recipient already has an account: a brand-new email gets a name +
   password form (`acceptInviteAction`) that creates the user pre-verified
   (the emailed link already proved the address); an existing company-less
   account can accept while signed in (`acceptPendingInviteAction`).
   Re-inviting a pending email re-sends rather than erroring; revoking
   deletes the pending row.
3. **Onboarding** — a Google sign-in has no password-based registration step,
   so a user with `companyId: null` lands on `/onboarding`
   (`frontend/src/app/(auth)/onboarding/page.tsx`) and either accepts a
   pending invite addressed to their email or creates a company
   (`createCompanyAction`), which is registration's create-company step
   without the credential signup. The `(app)` layout
   (`frontend/src/app/(app)/layout.tsx`) redirects any signed-in,
   company-less user to `/onboarding` before rendering the product shell.

**Backfill migration.** `backend/prisma/migrations/20260723054528_add_company_multi_tenancy`
adds the `Company`/`CompanyInvite` tables and the new `companyId` columns as
nullable first, then — only if the database already has at least one
`User` row — creates a `Default Company` and backfills every existing
`User`/`Job`/`Candidate`/`Application`/`ActivityLog` row onto it before
tightening the tenant-owned columns (everything but `User.companyId`) to
`NOT NULL`. A fresh, empty database skips the backfill entirely since the
`WHERE EXISTS (SELECT 1 FROM "User")` guard never fires.

## Data layer: Prisma 7 with a driver adapter

The generated client lives at `src/generated/prisma` (gitignored, produced by
`postinstall: prisma generate`) — application code imports
`PrismaClient`/types from `@/generated/prisma/client` and enums from
`@/generated/prisma/enums`, never `@prisma/client` directly. Connection
config is centralized in `prisma.config.ts`. `src/lib/db.ts` constructs the
client through the `@prisma/adapter-pg` driver adapter and caches a single
instance on `globalThis` in development to survive hot reload:

```ts
function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}
export const db = globalForPrisma.prisma ?? createClient();
```

Requirements are first-class rows (`JobRequirement`), not a JSON blob on
`Job`, so an `Evaluation` can foreign-key the exact requirement it judged and
weighting/reordering stays queryable rather than requiring a JSON migration.

## Scoring pipeline

Scoring is asynchronous. A request never waits on the LLM: it records a
`ScoringRun`, and a worker scores it moments later. Code lives in
`backend/src/scoring/` (engine, parse, math, queue) and
`backend/src/services/scoring.ts` (the tenant-facing entry points).

**Runs are the history.** Each `ScoringRun` stores its status
(`QUEUED -> RUNNING -> SUCCEEDED | FAILED`), the model, a prompt version
derived from the prompt templates themselves, the temperature, an
`inputHash` (sha256 of prompt version, model, temperature, job
title/description, the requirement set and the resume text), token usage,
latency and the raw model output. `Evaluation` rows belong to a run and are
never updated or deleted; `Application.latestScoringRunId` points at the run
the UI shows, and `aiScore`/`aiSummary`/`scoredAt` mirror it for sorting and
the dashboard. A rescore adds a run instead of replacing one, so every score
a decision was based on stays explainable. Pre-existing scores were migrated
into one `legacy` run per application.

**Requesting.** `requestScoring` (one application) and `requestJobScoring`
(every unscored, scorable applicant of a job, at most 200 per request) lock
the application rows (`SELECT ... FOR UPDATE`, in id order) so concurrent
clicks can't queue duplicates, then:

- return the run already in flight, if any (`in_progress`);
- if a `SUCCEEDED` run exists with the same `inputHash`, re-point the
  application at it and skip the LLM (`reused`): identical question,
  identical answer, no spend;
- otherwise check the AI quota (a bulk request is charged one company unit
  per LLM call) and insert a `QUEUED` run (`queued`).

A missing `GROQ_API_KEY` fails the request immediately rather than queueing
runs that can only fail.

**The worker** (`queue.ts`) is a Postgres queue, with no extra
infrastructure:

1. `claimNextRun` takes a transaction-level advisory lock, counts `RUNNING`
   runs, and claims the oldest due `QUEUED` run whose tenant is below
   `TENANT_CONCURRENCY` (2), while the total stays below
   `GLOBAL_CONCURRENCY` (8). The lock makes both caps exact across
   instances; the per-tenant cap is also the fairness rule.
2. `processRun` loads the application through the run's tenant-scoped
   client, calls the engine, and commits the run, its evaluations, the
   application pointer/mirror and the `application.score` audit row in one
   transaction, guarded on the claim (`status = RUNNING` and the same
   `lockedAt`) so a worker that lost its claim can't overwrite a newer one.
3. Failures are classified (`classifyProviderFailure`): 408/409/429/5xx and
   connection errors go back to `QUEUED` with exponential backoff (10s
   doubling per attempt, capped at 5 min, +/-20% jitter, never sooner than
   `Retry-After`) for up to 4 attempts; a rejected key or model
   (401/403/404) fails with an operator-facing message; anything else fails
   with the engine's user-safe message.
4. `recoverStaleRuns` returns runs left `RUNNING` by a dead worker (older
   than 3 min) to the queue, or fails them when out of attempts.

**Draining.** `drainScoringQueue` is safe to call anywhere, any number of
times. The app calls it via `after()` right after an enqueue, whenever a
client polls `GET /api/scoring/runs/[id]` or `GET /api/jobs/[id]/scoring`
while work is outstanding, and from `GET /api/cron/scoring` (bearer
`CRON_SECRET`; schedule it every minute to pick up retries nobody is
watching). Each drain claims for 15s; with two 20s-bounded LLM attempts the
worst case fits the 60s `maxDuration` those routes declare.

**The engine** (`engine.ts`) treats resume text strictly as data, calls Groq
with `response_format: { type: "json_object" }` and one corrective retry
when the output fails validation; the SDK's own retries are off because the
queue owns them. `parse.ts::reconcileResult` enforces exactly one evaluation
per known requirement id and strips any evidence quote that doesn't appear
verbatim in the resume. `math.ts::computeScore` is the weighted match: MUST
counts double, STRONG earns full credit, PARTIAL half, MISSING none.

**UI.** The score button queues and then polls the run every 2s (resuming
after a reload), showing *Queued* / *Scoring*; a failed run shows its reason
with a retry. The job page's *Score all unscored* button shows batch progress
and refreshes the ranking as scores land; table rows show *Queued* /
*Scoring* in place of a score. The application page lists the score history.

## Rate limiting

`src/lib/rate-limit.ts` is an in-process, fixed-window token bucket keyed by
an arbitrary string (e.g. `ip+email`). It is correct for a single serverless
instance per region — each cold-started instance has its own `Map` — which
is an explicit, documented limitation (see `docs/plan.md`, assumption 5).
Buckets are pruned once the map exceeds 10,000 entries to bound memory. The
named production upgrade is a shared store such as Upstash Redis so the
window is consistent across every instance and region.

## Email

`src/lib/email.ts` sends verification and password-reset email through
Resend when `RESEND_API_KEY` is set. When it isn't, `send()` logs the
recipient, subject, and action link to the server console instead of
throwing — local development and CI never block on having an email provider
configured. Seeded demo users are pre-verified so a reviewer running the demo
locally never needs to touch email at all.

## Testing strategy

- **Unit** (`tests/unit`, Vitest, `vitest.config.ts`) covers pure logic with
  no I/O: scoring math (`score-math.test.ts`), LLM response parsing and
  evidence reconciliation (`scoring-parse.test.ts`), the rate limiter
  (`rate-limit.test.ts`), and shared Zod validators (`validators.test.ts`).
  These run fast and don't need a database.
- **End-to-end** (`tests/e2e`, Playwright, `playwright.config.ts`) drives the
  real app on port 3105 and boots the dev server itself via `webServer` when
  one isn't already running, so `npm run test:e2e` works standalone in CI.

## Observability

- **Structured logs.** `@resumerank/core/observability/log` writes one JSON
  object per line (`level`, `event`, `time`, fields) for log drains to index.
  `withLogContext` opens an AsyncLocalStorage scope whose fields every nested
  line inherits; `runAction` opens one per action and the guards annotate it
  with `userId`/`companyId`, so an `llm.call` deep in a service is still
  attributable. Event names: `action` (outcome `ok`/`invalid`/`denied`/
  `rejected`/`error`, `durationMs`, `digest` on errors), `request.error`,
  `llm.call`, `llm.output_rejected`, `health.database`.
- **Server errors.** `src/instrumentation.ts` `onRequestError` logs every
  render/route/action error with Next's `digest` — the same reference the
  error boundaries (`(app)/error.tsx`, `global-error.tsx`) show the user — and
  the route, never headers or the query string.
- **Traces.** `register()` calls `registerOTel` (`@vercel/otel`). LLM attempts
  run inside `llm.scoring` / `llm.extraction` spans with OpenTelemetry GenAI
  attributes (model, input/output tokens) and record provider failures. On
  Vercel, traces reach a connected observability integration; elsewhere set
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Health.** `GET /api/health` runs a bounded `SELECT 1` (5s, enough for a
  Neon cold start) and returns 200 `{status:"ok"}` or 503, without detail.

## Security headers and CSP

`next.config.ts` sets a fixed set of headers on every route via `headers()`:
`Content-Security-Policy`, `Strict-Transport-Security` (2-year max-age, includes
subdomains, preload), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a locked-down
`Permissions-Policy` (camera/microphone/geolocation all denied). The CSP is
`default-src 'self'` with `'unsafe-inline'` (and `'unsafe-eval'` in dev only)
on `script-src` — the documented, pragmatic floor for Next.js without
per-request nonces — `img-src` additionally allows `blob:`, `data:`, and
Google's avatar CDN (`lh3.googleusercontent.com`) for OAuth profile images,
and `frame-ancestors 'none'` blocks the app from being framed.
