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

**Two backstops sit under the explicit filters** (`backend/src/tenant-db.ts`):

- `tenantDb(ctx)` is a Prisma client extension that injects `companyId` into
  top-level queries on the tenant-owned models and throws
  `TenantViolationError` when a query names another tenant. It can't see
  nested relation writes or raw SQL.
- `tenantTransaction(ctx, fn)` closes that gap with Postgres row-level
  security. It opens one interactive transaction and, in a single statement,
  sets the transaction-local `role` to `resumerank_tenant` and
  `app.company_id` to the tenant. The policies
  (`20261007090000_tenant_row_level_security`) bind only that role:
  `Company`, `CompanyInvite`, `Job`, `Candidate`, `Application`, `ScoringRun`
  and `ActivityLog` match on `companyId` (`id` for `Company`), and
  `JobRequirement`, `Scorecard` and `Evaluation` match through their parent,
  which is itself filtered. Foreign-key checks ignore RLS, so the
  `Application` and `ScoringRun` policies also require their parents to be
  visible — a row can't be attached to another tenant's job or candidate.
  The role only has `SELECT, INSERT` on `ActivityLog` and `Evaluation`, so
  the audit trail and scoring evidence are append-only from the app.
  Without the setting, no row matches.

Every service mutation runs in `tenantTransaction` (`tenantDb` deliberately
has no `$transaction`). Single reads stay on `tenantDb` outside a
transaction. Wrapping each one would add round trips, and RLS quals act as a
security barrier: non-leakproof search operators (`ILIKE`, full-text `@@`)
couldn't use their GIN indexes. Connections that never switch role (auth,
onboarding, the cross-tenant scoring claim, seeds, migrations) run as the
table owner, which RLS doesn't apply to. Both settings are `SET LOCAL`, so a
pooled connection (including PgBouncer transaction mode) goes back as the
owner on commit or rollback.

The migration creates the role and grants it to the migrating role, so
`SET ROLE` works there. If production connects as a different role than
migrations do, grant `resumerank_tenant` to that role too. `User` has no
policy: users are identities rather than tenant data, removing a member sets
their `companyId` to null, and invites look up users by email across
workspaces. `backend/tests/integration/rls.test.ts` fails if a new table with
a `companyId` lands without a policy. A new table that a tenant transaction
touches needs a `GRANT` in its migration, or the transaction fails with
`permission denied`.

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
const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX ?? (serverless ? 3 : 10),
  connectionTimeoutMillis: 10_000,
  statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS, // omitted when 0
});
```

**Connections.** Every serverless instance holds its own pool, so the pool is
small on Vercel (3) and the database is reached through a transaction-mode
pooler (PgBouncer / Neon `-pooler`) in `DATABASE_URL`. Migrations need a
session connection, so `prisma.config.ts` prefers `DIRECT_URL` when set;
`backend/src/db.ts` warns at startup on Vercel when it isn't. The app holds no
session state across statements (the scoring queue uses
`pg_advisory_xact_lock`, which is transaction-scoped), so transaction pooling
is safe. `statement_timeout` (default 15s) stops a runaway query from pinning
a connection; it travels as a startup parameter, so set
`DATABASE_STATEMENT_TIMEOUT_MS=0` and put it on the database role instead if
a pooler rejects it.

**Lists use keyset pagination.** Every list (jobs, candidates, applicants,
activity) pages with opaque `after` / `before` cursors that encode the sort key
and id of the edge row (`backend/src/services/pagination.ts`), never
`OFFSET`, so page 400 costs the same as page 1. Each sort has a `KeysetSort`:
its direction, a cursor-key parser, the "strictly past this row" condition and
the `ORDER BY`. The id tie-breaker always sorts in the key's direction, so one
index serves both the forward scan (Next) and the reversed scan (Prev, whose
rows are flipped back afterwards). Every list sort has a matching index ending
in `id`; the applicant score index is `aiScore DESC NULLS LAST` (hand-edited
in the migration, since Prisma can't express null ordering) and partial on
`deletedAt IS NULL`, like the other Application list indexes. A stale or
hand-edited cursor restarts the list at page one. Totals are counted up to
`COUNT_CAP` (1,000) and then shown as "1,000+", so a page never counts a whole
large tenant.

**Search.** Name, email, headline and job-title search use `ILIKE`, served by
`pg_trgm` GIN indexes. Candidate search also matches resume text through
`Candidate.resumeTsv`, a `tsvector` column the database generates from
`resumeText` (GIN-indexed, queried with `websearch_to_tsquery`). Prisma can't
filter on that column, so the candidate list selects ids with raw SQL (scoped
to `companyId` by hand, since the tenant extension can't see into raw SQL)
and then loads the rows with Prisma. The "Add candidate" picker on a job is a
server-side typeahead (`GET /api/jobs/[id]/candidate-options`, 20 matches per
query) instead of a list of every candidate.

**Deletion policy, per entity.**

| Entity | Policy | Why |
| --- | --- | --- |
| Application | Soft delete (`deletedAt`), restorable | Removing someone from a pipeline is often a mistake; restore brings back scores, runs and scorecards. Every application read filters `deletedAt: null` except the detail page, which shows a restore banner. |
| Job | Never deleted; archived through `status = ARCHIVED` | A job anchors its applications and their scoring history; archived jobs drop out of the open-job pickers and refuse new applications. |
| Candidate | Hard delete, cascading to applications, runs and evaluations | A candidate is personal data; deletion has to actually erase it (GDPR erasure). The activity log keeps only the entry's summary and id. |
| User | Hard delete; authored activity is kept with a null actor ("Deleted user") | The audit trail outlives the account. |

Requirements are first-class rows (`JobRequirement`), not a JSON blob on
`Job`, so an `Evaluation` can foreign-key the exact requirement it judged and
weighting/reordering stays queryable rather than requiring a JSON migration.

## Rendering and caching

**Cache Components is on** (`cacheComponents: true`). Every route prerenders
a static shell and streams whatever depends on the request:

- The signed-in layout wraps the session check in `<Suspense>` with
  `AppShellSkeleton`, a frame with the same sidebar, top bar and content
  column, so the app renders instantly and swaps the real shell in.
- The `(auth)` layout does the same with a card-shaped skeleton, since those
  pages read the session or a token from the URL.
- The marketing page is fully static; its footer year comes from a
  `use cache` helper with a daily lifetime.
- `GET` route handlers that branch before reading the request call
  `await connection()` first, or the build would prerender that branch.
  `/api/cron/scoring` needs it: without `CRON_SECRET` at build time it
  returned its 404 without touching the request, and was prerendered as a
  static 404.

**One user lookup per request.** `requireUser` (and so `requireMember` /
`requireWriter` / `requireAdmin`) is wrapped in React `cache()`, so the
layout, the page, `generateMetadata` and every query they call share one
session read and one user query. Server actions and route handlers run
outside a render, where `cache()` is a pass-through, so each call there
still re-checks the database.

**The dashboard is cached per user and tenant.** `server/queries/dashboard.ts`
runs the guard, then calls a `use cache` function whose argument is the
tenant context, so the user and company are part of the cache key and an
entry is only ever served back to whoever built it. Entries carry the tag
`company:<id>:dashboard` (`server/cache-tags.ts`):

- Every server action that writes activity calls `expireTenantReads(companyId)`,
  which runs `updateTag`, so the actor's next dashboard load waits for fresh
  data. That covers every mutation, since the dashboard shows the recent
  activity feed.
- The scoring drain returns the tenants whose runs it processed. Its
  callers, `after()` and the cron route, expire those tags with
  `revalidateTag(tag, { expire: 0 })`, because `updateTag` only works inside
  server actions.
- Page-level `revalidatePath` calls stay, since they refresh the page the
  user is on. Only the path-wide `revalidatePath("/dashboard")` calls became
  tags.

**Limits of the default cache.** `use cache` stores entries in each server
instance's memory, and tag expiry only reaches the instance that handled the
mutation. Two consequences:

- On serverless, entries rarely survive between requests, so the cache mostly
  helps self-hosted and long-lived instances.
- With several instances, another instance can serve a copy older than a
  mutation. The dashboard's lifetime (`revalidate` 30s, `expire` 60s) bounds
  that window.

Sharing entries and tag expiry across instances needs a `cacheHandlers`
implementation, or `use cache: remote` on a platform that provides one.
Until then, only aggregates that tolerate a minute of staleness belong in
`use cache`. Lists and detail pages stay uncached: their keys (filters,
cursors, ids) rarely repeat, and they must reflect writes immediately.

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

**Provider layer** (`backend/src/ai/llm.ts`). Scoring and extraction both
call `completeJson`, which:

- sends one bounded request through an `LlmProvider` (Groq today: one
  pooled client, the SDK's own retries off, a per-request timeout) and
  traces it with `traceLlmCall`;
- feeds a validation failure back to the model once;
- falls through to `GROQ_FALLBACK_MODEL` on a transient or model-not-found
  failure;
- skips a model whose per-process circuit is open (5 consecutive provider
  failures, 30s cooldown, then half-open). If every circuit is open it throws
  `ProviderUnavailableError`, which the queue treats as transient.

The model that actually answered is recorded on the run and goes into its
input hash.

**Untrusted input** (`backend/src/ai/untrusted.ts`). Every field the
model reads that someone else wrote goes in its own block: the job title,
description, requirement labels (one per line, so a label can't fake a
row) and the resume. Each block is `<<<ID:NAME>>> … <<<ID:END>>>`, where
`ID` is a hash of the content, so text can't contain its own closing
marker. Runs of `<<<`/`>>>` inside the text are defused and invisible
characters are stripped. `detectInjection` flags resumes that look written
to steer the model: requests to ignore instructions, role changes, fake
system lines, score requests, forged JSON, block markers and hidden
characters. The signals are stored on the run (`injectionSignals`) and
shown on the application page as a warning. They never change the score. A
live check with an injected resume produced unchanged verdicts and four
signals.

**Evidence** (`scoring/parse.ts`). `reconcileResult` enforces exactly one
evaluation per known requirement id, then checks every quote against the
resume. Matching keeps only letters and digits after NFKC normalization, so
ligatures, curly quotes, bullets and hyphenated line breaks from PDF text
don't fail a real quote, while the words still have to appear in order. Each
evaluation stores `evidenceStatus` (`VERIFIED` / `UNVERIFIED` / `NONE`),
the quote as cited, and `modelVerdict`. STRONG means "the resume
explicitly demonstrates it", so a STRONG without a verified quote is stored
and counted as PARTIAL. Pages only ever receive verified quotes. An
unverified one is reported by status, with a note explaining a capped
verdict.

**Determinism.** Temperature 0 and a fixed seed (both recorded on the run
and part of the input hash). In a live check, identical inputs gave
identical verdicts and evidence statuses, though the free-text notes still
varied slightly, which is why the hash-based reuse of a successful run
matters. The score history shows the range when runs on an application
disagree.

`math.ts::computeScore` is the weighted match: MUST counts double, STRONG
earns full credit, PARTIAL half, MISSING none.

**UI.** The score button queues and then polls the run every 2s (resuming
after a reload), showing *Queued* / *Scoring*; a failed run shows its reason
with a retry. The job page's *Score all unscored* button shows batch progress
and refreshes the ranking as scores land; table rows show *Queued* /
*Scoring* in place of a score. The application page lists the score history.

## Rate limiting

All limits live in Postgres (`backend/src/rate-limit.ts`), so they hold
across every serverless instance and survive cold starts. `RateLimitCounter`
stores one row per key per fixed window; a limit reads the current and the
previous window and estimates a **sliding window**
(`previous x (1 - elapsed) + current`), which avoids the 2x burst a fixed
window allows at its boundary without a row per request.

`rateLimit(key, { max, windowMs }, cost)` checks and spends in one
statement: `INSERT ... ON CONFLICT DO UPDATE ... WHERE <fits>` locks the
conflicting row and re-evaluates the condition against its latest value, so
parallel requests can never overshoot `max`, and a request that would
overshoot is refused whole without spending anything. `peekRateLimit` checks
without spending; `recordUsage` adds usage that has already happened. Expired
rows are swept opportunistically (1% of calls), so no scheduled job is needed.

| Limit | Key | Budget |
|---|---|---|
| Registration, verification resend, password reset, invites | IP / IP + email / inviter | 5 per 15 min |
| Login attempts from one IP (any account) | `login:ip:<ip>` | 30 per 15 min |
| Failed logins on one account (any IP) | `login:fail:<email>` | 10 per 15 min, cleared on success |
| AI requests per user | `ai:user:<id>` | 30 per 10 min |
| AI calls per company (a bulk request counts each applicant) | `ai:company:<id>` | 300 per hour |
| AI tokens per company | `ai-tokens:company:<id>` | `AI_TOKEN_BUDGET` (5M) per rolling 30 days, or `Company.aiTokenBudget` |

**Login throttling runs inside the Credentials provider's `authorize()`.**
Auth.js also exposes that provider at `POST /api/auth/callback/credentials`,
so a limit placed only in the login form's server action could be bypassed
by posting there directly. A throttled attempt is refused before the
password is checked (so it reveals nothing), failures count for unknown
emails too (so lockout doesn't reveal which accounts exist), and the lockout
is temporary, never permanent, since anyone could trigger it against a victim;
password reset still works meanwhile. The login form peeks first only to show
how long to wait.

**Client IP** comes only from a source the client can't forge
(`backend/src/request-ip.ts`): `TRUSTED_IP_HEADER` if set (e.g.
`cf-connecting-ip` behind Cloudflare), otherwise on Vercel
`x-vercel-forwarded-for` (set by Vercel; a proxy in front can't overwrite
it), otherwise the **last** `X-Forwarded-For` hop, the one the nearest proxy
appended, never the first, which the client controls. Anything that isn't a
valid IP falls into one shared `unknown` bucket.

**AI token budget** (`backend/src/ai-budget.ts`) is checked before work
starts (scoring requests, each queued run, resume autofill) and charged with
the real token counts after the model answers, so a tenant can overshoot by
at most the requests already in flight. Settings, Company shows the usage.

## Email

Transactional email (verification, invites, password resets) goes through
a Postgres outbox (`backend/src/email/`), on the same pattern as the
scoring queue. No request waits on an email provider, and no email is lost
to a provider blip.

**Queueing.** `queueVerificationEmail`, `queueInviteEmail` and
`queuePasswordResetEmail` (`email/messages.ts`) render the message and
write an `EmailMessage` row through whatever transaction client they are
given, so the row commits with the token or invite it carries, or not at
all. Registration, resend-verification and forgot-password do this in a
`db.$transaction`. `inviteMember` does it inside its
`tenantTransaction`, where the tenant role has `INSERT` but not
`SELECT` on the table, so the insert uses `createMany` (no
`RETURNING`). Forgot-password now responds just as fast whether or not
the account exists, because nothing is sent inline.

**Payload confidentiality.** The rendered message contains a raw token,
which the token tables deliberately never store. The payload is sealed with
AES-256-GCM under an HKDF subkey of `AUTH_SECRET`
(`email/sealed.ts`). The row id and recipient are the associated data, so
a payload copied to another row, or a `to` edited to redirect a reset
link, fails to open and the message fails instead of going out. Every
terminal status nulls `payload`, and terminal rows are pruned after 30
days. Rotating `AUTH_SECRET` makes still-queued messages fail as
unreadable, and users can request a fresh link.

**Delivery** (`email/outbox.ts`):

1. `claimNextEmail` moves one due `QUEUED` row to `SENDING` with
   `FOR UPDATE SKIP LOCKED`, so overlapping drains never double-send.
2. A message whose link has expired is marked `EXPIRED`. One to a
   suppressed address is marked `SUPPRESSED`.
3. `deliverEmail` (`email/transport.ts`) picks Resend, then SMTP, then
   a log line, as before. Resend calls carry the idempotency key
   `email-outbox/<id>`, so re-sending after a lost response is a no-op
   at Resend.
4. Failures are classified. For Resend, 429, 5xx, quota and network errors
   are retried. For SMTP, 4xx replies and connection errors are retried,
   while 5xx replies and bad credentials are not. Retries back off
   exponentially (30s doubling, capped at 30 min, +/-20% jitter) for up to
   6 attempts, and never past the link's own expiry. Otherwise the message
   is `FAILED` with the provider's reason.
5. `recoverStaleEmails` puts rows stuck in `SENDING` for more than 2
   minutes back in the queue.

`scheduleEmailDrain()` (`frontend/src/server/email-drain.ts`) drains
after the response of every action that queues mail. `GET /api/cron/email`
(bearer `CRON_SECRET`, shared with the scoring cron through
`server/cron-auth.ts`) picks up retries; schedule it every minute.

**Bounces and complaints.** `POST /api/webhooks/resend` is enabled by
`RESEND_WEBHOOK_SECRET` together with `RESEND_API_KEY`. It verifies the
Svix signature over the raw body, rejecting stale timestamps, before
anything is parsed. A permanent bounce or a complaint adds the address to
`EmailSuppression` and marks the message `BOUNCED` / `COMPLAINED`. A
transient bounce is recorded but doesn't suppress, and a delivery sets
`deliveredAt`. SMTP has no webhook equivalent. To un-suppress an address,
delete its `EmailSuppression` row.

With no provider configured, the action link is written to the server log
(`email.logged`), so local development and CI never block on email.
Seeded demo users are pre-verified.

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
