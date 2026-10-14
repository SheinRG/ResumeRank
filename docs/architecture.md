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

`src/lib/auth/guards.ts` exports `requireUser`, `requireMember`, `requireCan`
and `requireAdmin`. All of them re-fetch the user from the database on every call:

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

The session JWT carries `user.id` and the sign-in's `loginId`, never a role
or company: one account can hold different roles in different workspaces.
Authorization is decided by the fresh database rows, so a role downgrade
takes effect on the very next request instead of waiting for the JWT to
expire. `requireMember` additionally requires an open workspace
(narrowing the return type to `CompanyUser`, where `companyId` is non-null) —
`requireCan` and `requireAdmin` both call it first, so every write path
already has a company to scope to before it checks verification or role.
`requireCan(permission)` additionally rejects unverified emails and roles
without that permission; `requireAdmin` requires owner or admin. No action
trusts a client-sent role or id.

### Roles, permissions and job access

Six roles. Checks name a **permission**, never a role
(`backend/src/auth/roles.ts`), so a custom role later is a new row in that
table rather than a sweep through call sites:

| Role | Reaches | Can |
|---|---|---|
| Owner, Admin | every job | everything (`department.manage` included) |
| Recruiter (`MEMBER`) | every job | everything but managing departments |
| Hiring manager | assigned jobs | edit them, move stages, request and see scores, read and submit scorecards |
| Interviewer | assigned jobs | read the job and resume, submit their own scorecard |
| Viewer | every job | read, including scores and every scorecard |

The guard checks the permission (`requireCan`), and the service checks it
again (`assertCan`) so a worker or API adapter can't skip it. **Which jobs**
a role reaches is decided in the services, which have the data:
`backend/src/services/access.ts` turns the context into Prisma filters
(`jobAccessWhere`, `applicationAccessWhere`, `candidateAccessWhere`) and raw
SQL predicates (`jobAccessSql`, `candidateAccessSql`). For company-wide roles
they're empty; for hiring managers and interviewers a job is reachable when
they're on its hiring team (`JobAssignment`) or in its `Department`
(`DepartmentMember`), and candidates only through a live application on such
a job. Outside those, ids behave as missing, exactly like another tenant's.

Interviewers rate blind. A role without `scoring.view` gets every AI output
left out by the service (score, summary, verdicts, run history, the dashboard's
score figures, score sorting), and one without `scorecard.viewAll` gets back
only its own scorecard — nothing to hide on the page because nothing reaches
it. The activity feed spans every job, so it needs `activity.view`, which
the restricted roles don't have.

Assignments and department memberships reference the `Membership` row
(`userId, companyId`) with a cascading foreign key, so leaving a workspace
ends the access with it, whichever path removed the membership (team page,
SCIM, account deletion). A job's hiring team and department are set from its
Hiring team panel (`job.staff`); departments are managed in Settings →
Departments (admins). `20261017090000_granular_rbac` adds the roles and the
three tables, expand-only: the previous release reads an unknown role as
read-only.

**Ownership transfer.** A workspace may have several owners; an owner can
make a teammate an owner from the team table, and only owners change or
remove other owners. Handing the workspace over is its own flow (Settings →
Company, `transferOwnership` in `services/team.ts`): one tenant transaction
promotes the teammate and steps the caller down to the role they pick, so
there is never a moment with no successor or an extra owner. Both updates are
conditional on the roles just read, so if another owner changes either person
meanwhile, the transfer aborts instead of overwriting them. The caller types
the workspace name and, if the account has one, its password (rate-limited
like a login). The new owner must already be a member with a verified email,
because they take over the security policies. The audit log records it as
`company.ownership_transfer`.

## Two-factor authentication

People can add an authenticator app (TOTP), passkeys or security keys
(WebAuthn), and they get ten one-time recovery codes with their first factor.
MFA belongs to the user rather than the workspace, so the self-service code
lives in `backend/src/auth/mfa/` and takes the user's own id. The workspace
pieces are in `services/mfa.ts`: the owner-only "require MFA" policy and the
admin reset. Settings → Security covers both.

**The gate.** Every sign-in's token carries a random `loginId`. Once a
factor is proven, the token also gets `mfaEpoch`, which is
`User.mfaEnabledAt` at the moment of proof. `getSignedInSession` (in the
guards) works out `mfaGate` (`auth/mfa/policy.ts`) on every request from the
fresh user row:

- `challenge`: the user has a factor and this sign-in hasn't proven the
  current epoch.
- `setup`: the company requires MFA and the user has no factor yet.
- `pass`: neither applies.

`requireUser` throws `MfaChallengeRequiredError` / `MfaSetupRequiredError`,
and pages send those to `/mfa` and `/mfa/setup`. Only
`requireMfaChallenge` and `requireMfaEnrollment` let a gated session in. The
enrollment guard refuses a session that still owes a challenge, so a password
alone can't add a factor to an account that already has one.

Turning MFA off and on again, or an admin reset, starts a new epoch, so every
older session has to verify again. Single sign-on sessions always pass,
because the identity provider owns MFA there.

**Marking a session verified.** The browser can post its own payload to the
Auth.js session-update endpoint, so the `jwt` callback doesn't believe a plain
"verified" flag. A server action that has just checked a factor mints a
proof with `mintMfaProof` (`auth/mfa/proof.ts`): an HMAC, under an
`AUTH_SECRET` subkey, over the `loginId` and the epoch, valid for 60
seconds. It passes the proof to `refreshSession`, and the callback stores the
epoch only if the proof verifies for this sign-in.

**Factors.**
- **TOTP:** RFC 6238 with SHA-1, 6 digits, a 30-second period and one step
  of drift. Secrets are sealed with AES-256-GCM (`sealed-box.ts`) under
  `MFA_ENCRYPTION_KEY`, or an `AUTH_SECRET` subkey without it, and bound to
  the user id. Each accepted code claims its time step with a conditional
  update, so a code works once.
- **Passkeys:** `@simplewebauthn/server` with `none` attestation, bound to
  the hostname of `AUTH_URL`. Each ceremony's challenge is stored per user
  and deleted before the response is checked, so it can be answered only
  once. A signature counter that doesn't move forward (a cloned key) is
  refused.
- **Recovery codes:** 80 random bits each, stored as SHA-256 hashes,
  consumed with a conditional update. Using one is written to the activity
  log.

All checks share a limit of 10 attempts per user per 15 minutes,
`MFA_ATTEMPT_LIMIT`. Removing the last factor turns MFA off and voids the
recovery codes, unless the company requires MFA, in which case the removal is
refused.

**Policy and resets.** Only an owner can require MFA, and only after setting
it up themselves. Owners aren't exempt, unlike SSO enforcement: recovery
codes and the admin reset cover lockouts. `resetMemberMfa` deletes a
teammate's factors inside a tenant transaction and bumps their
`sessionVersion`. The factor tables' RLS policies expose only rows of the
company's own users, and the tenant role may only read and delete them.

## Sessions

Sessions are Auth.js JWTs, so the server can't delete one. Instead, every
sign-in writes a `LoginSession` row whose id is the token's `loginId`
(`jwt` callback → `startLoginSession` in `auth/sessions.ts`, with the sign-in
method, user agent and `clientIp`). `getSignedInSession` loads that row with
the user on every request and ends the session (`/session-ended`) when
`sessionEnd` (`auth/session-policy.ts`) says it is:

- `revoked`: signed out, revoked from the sessions list, or ended by an admin;
- `expired`: older than the company's `sessionLifetimeMinutes`;
- `idle`: no request for `sessionIdleMinutes`.

Both limits are read on each request from the workspace the session has open
rather than stamped at sign-in, so an owner tightening them ends existing
sessions past the new limit too. People without a company get
`DEFAULT_SESSION_POLICY`. The cookie's
own lifetime is the 30-day maximum; the row always ends a session first.
`lastSeenAt` is rewritten at most once a minute, so most requests only read.

`sessionVersion` still kills every token at once. Whatever bumps it also calls
`revokeUserSessions` in the same transaction (keeping the current sign-in on
a password change), so the sessions list matches what the guards enforce.
Leaving a workspace ends only the sessions open in it
(`revokeWorkspaceSessions`). In a tenant transaction either runs before the
membership goes, because the `LoginSession` RLS policy (like the MFA tables')
only exposes rows of the company's own members. The tenant role may read and update
them, nothing else. Sign-in clears the user's revoked and long-dead rows, so
the table needs no sweeper.

Self-service code (list, revoke one, revoke the others) takes the user's own
id and current `loginId` (`SessionActor`), like MFA. The workspace pieces are
in `services/sessions.ts`: the owner-only lifetime policy and an admin's
"sign out everywhere" for a teammate. Tokens issued before sign-ins were
recorded have no row, so they ended once when this shipped.

## Audit log

`ActivityLog` is the audit trail, and it is tamper-evident. The
`20261015090000_audit_log` migration adds three things in the database, so
they hold whatever code path writes:

- **A hash chain per company.** `audit_seal`, a deferred constraint trigger,
  runs as the inserting transaction commits. It takes a per-company advisory
  lock and stamps the entry with the next `seq`, the previous entry's hash
  (`prevHash`) and its own `hash`, which is `audit_entry_hash` (SHA-256 over a
  `jsonb` array of the previous hash, company, seq, time, action, entity,
  summary and metadata). Sealing at commit means `seq` follows commit order,
  so anyone who can see entry *n* can already see every entry before it. The
  lock is taken after every other lock the transaction holds, so it can't
  deadlock with them, and it is held only until the commit. Inside the
  inserting transaction the three columns are still null. The actor is left
  out of the hash because deleting an account clears it.
- **A guard.** `audit_log_guard` refuses `UPDATE`, `DELETE` and `TRUNCATE` for
  every role, the owner included. It lets through only the seal itself, an
  account deletion clearing `actorId`, the cascade when a company is deleted
  (`pg_trigger_depth() > 1`), and the retention purge (`app.audit_purge`).
- **Verification.** `verifyAuditLog` (`services/audit.ts`) recomputes every
  hash with the same SQL function and walks the links. `findChainBreak`
  (`audit/chain.ts`) names the first fault: an edited entry, a missing one,
  one that doesn't point at its predecessor, or the oldest entries deleted
  without a retention purge to account for it. A database superuser can still
  turn the triggers off; the chain is what makes that visible.

**Retention.** Owners pick how long entries are kept (`Company.auditRetentionDays`,
from a fixed list; null means forever). `purgeExpiredAuditEntries`
(`audit/retention.ts`) deletes a whole prefix of the chain, by `seq`, never
the newest entry, so `seq` and every stream cursor keep counting. It records
an `audit.purge` entry with the last deleted `seq` and hash, and verification
accepts the gap only when that record exists.

**Export.** `GET /activity/export?format=csv|jsonl&from&to` (admins) streams
the log oldest first, with each entry's chain hashes. It covers only the
entries that existed when it started, and it writes `audit.export` before the
first byte. CSV cells go through `csvRow`, which defuses spreadsheet formulas.

**SIEM streaming.** Each company can have one `AuditStream` (owner-managed):
a signed HTTPS webhook (Stripe-style `ResumeRank-Signature: t=…,v1=HMAC`),
Splunk HEC or Datadog Logs. `drainAuditStreams` (`audit/stream.ts`) claims due
streams with `SKIP LOCKED`, sends the next 500 entries after `cursorSeq`, and
moves the cursor only on a 2xx. Failures back off from a minute up to an
hour. Delivery is at least once, so receivers deduplicate on `id`. A new
stream starts at the newest entry, and an export covers history. The token
is sealed under an `AUTH_SECRET` subkey, bound to company, kind and URL, so a
row edited to point somewhere else can't decrypt it. Requests go out through
`audit/outbound.ts`: https only, with private, loopback, link-local and
metadata addresses refused both when the stream is saved and at connect time
(the lookup the socket uses is the one that's checked), and redirects aren't
followed. `GET /api/cron/audit` (bearer `CRON_SECRET`) runs the purge and the
drain; schedule it every minute.

**Sign-in events.** `auth.sign_in` and `auth.sign_out` are written with the
`LoginSession` row (`auth/sessions.ts`). `auth.sign_in_failed` (wrong password,
past the throttle) and `auth.sign_in_refused` (SSO required) are written in
`authorize`. `auth.mfa_passed` and `auth.mfa_failed` come from
`auditMfaChallenge`, which runs after the attempt limit so blocked attempts
don't fill the trail. They are stored in every workspace the user belongs
to (the account is shared), and only admins see them in the activity feed,
since they carry IPs and devices. `auth.workspace_switch` records a sign-in
entering a workspace. The dashboard leaves them out.

## Workspaces

One account can belong to several companies, an agency and its clients, say,
or a consultant's engagements, with a role in each. `Membership` is the
source of truth; `20261016090000_memberships` adds it and backfills it from
`User.companyId` and `User.role`.

- **Each sign-in has one workspace open** (`LoginSession.companyId`), so a
  laptop and a phone can work in different companies. The guards resolve it
  on every request (`resolveWorkspace`, `backend/src/auth/workspace-policy.ts`):
  the open one while the user still belongs to it, else where a new sign-in
  would land. Role, MFA policy, session lifetime and tenancy all come from it.
- **Landing.** A new sign-in opens the company whose identity provider it
  came through, else the workspace last switched to (`User.companyId`, now
  the default), else the oldest, skipping any it may not open.
- **Switching** (`switchWorkspace`, the switcher at the top of the sidebar)
  checks the membership, points the sign-in at the workspace, makes it the
  default and records `auth.workspace_switch` in the workspace entered.
- **Single sign-on is per company.** `LoginSession.ssoCompanyId` records whose
  IdP vouched for the sign-in, and only that company's SSO requirement is met
  by it (`signInMayOpen`). A password sign-in is refused only when every
  workspace the user belongs to requires SSO; otherwise it lands in one that
  doesn't, and the others show as needing SSO in the switcher. The IdP's MFA
  exemption also holds only inside its own company.
- **Account-wide things stay with the account.** Sign-in events
  (`logAuthEvent`) go to the trail of every workspace the user belongs to.
  Removing someone from a workspace (`removeMember`, SCIM deprovisioning)
  deletes that membership and ends only the sessions open in it. An admin can
  still sign a teammate out everywhere (a stolen laptop is stolen
  everywhere), but can't reset the second factor of someone another company
  shares (`belongs_elsewhere`, a `SECURITY DEFINER` function, answers that
  without exposing the other memberships). Removing the last factor is
  refused if any of the user's workspaces requires MFA. Deleting an account
  needs another owner in every workspace, and re-homes the records in each.

**Compatibility.** The migration is expand-only. `User.companyId` and
`User.role` stay, now meaning the default workspace and the role there, and
two triggers keep them and `Membership` in step: `membership_mirror` keeps the
default pointing at a workspace the user still belongs to, and
`membership_from_user` turns writes by code deployed before memberships
(joining, re-roling and removing people through those two columns) into
membership changes. The switch is the one place current code writes them; it
sets `app.workspace_switch` so the second trigger doesn't replay a stale role.
Dropping `User.role`, `User.directoryUserId` and both triggers is the
contract step for a later release.

## Feature flags and entitlements

A flag is decided per company, so everyone in a workspace sees the same
thing. Flags are defined in code (`backend/src/flags/registry.ts`), each
one either a **release** (a new feature reaching tenants gradually) or an
**entitlement** (something a workspace may or may not use, which plans will
grant). There is no flag vendor: state lives in Postgres like the rate
limits and queues, so local, CI and production behave alike.

**Resolution** (`flags/resolve.ts`, pure) goes in this order:

1. A staff **override** for the company (`FeatureFlagOverride`).
2. The flag's **rollout percentage**: the company's bucket, 0–99, is a
   SHA-256 of the flag and company id. A company keeps its bucket, so raising
   the percentage only adds companies. Each flag hashes differently, so the
   same tenants aren't first in line for every release.
3. The flag's **default**.

Today's flags are entitlements on the enterprise features: `sso`,
`directory-sync` and `audit-streaming`. All three default to on, so the
flags change nothing for existing tenants until an override is set.

**Enforcement** happens in the services, like roles do.
`assertFeature(ctx, flag)` (`services/features.ts`) throws
`FeatureUnavailableError`, a `ForbiddenError`, before a feature is turned
on or used: saving an SSO connection, requiring SSO, connecting directory
sync, and saving, testing or resuming an audit stream. Turning something
*off* is never gated, so a workspace that loses a feature can still
disconnect it. Work without a tenant context checks `companyHasFeature`
(`flags/evaluate.ts`):

- **SCIM requests** for an unentitled company get a 403 the identity provider
  reports as a provisioning error, instead of changes being stored and never
  applied. The check runs only once the directory's bearer token matches,
  so callers without the token still get the usual 401 or 404.
- **The audit stream drain** holds an unentitled company's stream in place:
  its cursor doesn't move, there's no failure or backoff, it re-checks
  hourly, and once the feature returns, delivery catches up on every entry
  written meanwhile.
- **SSO sign-in** through an existing connection keeps working. Refusing it
  would strand members whose only way in is the identity provider, so losing
  `sso` stops a workspace from changing or requiring SSO but doesn't lock
  anyone out.

Pages read the whole set once (`getFeatures`, `server/queries/features.ts`)
and replace a feature's setup with a "not enabled for this workspace"
notice (`components/settings/feature-unavailable.tsx`), keeping only the
controls that turn it off.

**Overrides are staff-only.** The tenant role may read
`FeatureFlagOverride` (RLS, `tenant_isolation`) but not write it. Staff use
`npm run flags`, which connects as the table owner like seeds do:

```
npm run flags -- list
npm run flags -- show <company-slug>
npm run flags -- set <company-slug> <flag> on|off --reason "..."
npm run flags -- clear <company-slug> <flag>
```

Every change writes `feature.override` to the company's own audit log, so
its admins see it in the feed under the "ResumeRank" actor. Point it at
another database with `DATABASE_URL=...`. Rollout percentages are code
changes, reviewed like any other. Removing a flag from the registry leaves
its rows inert, and `20261018090000_feature_flags` is expand-only.

## Public API and webhooks

The REST API (`/api/v1`, reference in `docs/api.md`) is a third adapter over
the same services, next to server actions and the queue workers.

**Keys.** `ApiKey` rows hold a SHA-256 of a 256-bit secret. The token
(`rr_<id>_<secret>`, `backend/src/api/tokens.ts`) carries the row id, so
authentication is one primary-key read. That read runs on the owner
connection, because the key is what names the tenant; `authenticateApiKey`
(`backend/src/api/auth.ts`) then returns an ordinary `TenantContext`. A key
acts as its creator: the context's role is their **current** membership role,
read on every request, and the row references that membership with a
cascading foreign key, so leaving the workspace deletes their keys. Scopes
(`validators/api.ts`) only narrow on top of that. `handleApi`
(`frontend/src/server/api-route.ts`) authenticates, rate-limits per key
(Postgres-backed, 600/min), checks the scope, maps `DomainError`s to HTTP
statuses, and writes one `api` log line. Every route then calls the same
service the app does, so role checks, job access and tenant scoping apply
unchanged, and another tenant's ids answer 404. Responses go through explicit
serializers (`backend/src/api/serialize.ts`), so a field added for the app
never leaks into the contract. Writes are attributed to the key's creator in
the activity log. Keys aren't subject to session policies (SSO, MFA,
lifetime); that's why only admins can create them, and they can expire.

**Webhooks.** `WebhookEndpoint` holds the URL, the subscribed events and the
signing secret, sealed under an `AUTH_SECRET`-derived key and bound to the
company and URL. `queueWebhookEvent` (`backend/src/webhooks/outbox.ts`)
writes a `WebhookDelivery` row per subscribed endpoint inside the
mutation's own tenant transaction: `createApplication`, `updateStage` (only
when the stage really changes) and the scoring worker's commit. An event
exists if and only if its change committed. `drainWebhooks`
(`webhooks/delivery.ts`) claims due rows with `SKIP LOCKED`, signs the body
like the audit stream (`t=…,v1=HMAC-SHA256`), and posts through
`postOutbound`, which resolves and checks the address on every connection,
so DNS rebinding can't reach internal hosts. A failure backs off (1 minute
doubling to an hour) and is marked `FAILED` after 10 attempts. Delivery is at
least once and unordered, so receivers dedupe on the payload `id`. Drains run
via `after()` from the adapters that queue events (and after a scoring drain
that finished runs), and from `GET /api/cron/webhooks`, which also purges
settled rows after 30 days. A paused endpoint keeps queueing but is not drained, so resuming it sends everything that happened meanwhile. Settings →
API (admins) manages keys and endpoints and shows recent deliveries.
`20261020090000_public_api` adds the three tables with RLS (expand-only).

## Multi-tenancy

ResumeRank runs many companies on one shared Postgres database, isolated by
row-level `companyId` scoping rather than a database- or schema-per-tenant
split. `Job`, `Candidate`, `Application`, and `ActivityLog` all carry a
required `companyId`; `Candidate.email` is unique per company
(`@@unique([companyId, email])`), not globally, so two different companies
can each have their own candidate at the same address. People are not
tenant data: a `User` is an account, and `Membership(userId, companyId, role)`
says which workspaces it belongs to, with a role in each (see Workspaces
below). An OAuth sign-up exists before it has any membership.

**Enforcement lives in the guards, not in ad-hoc `where` clauses scattered
through the app.** `requireMember()` (`frontend/src/lib/auth/guards.ts`)
re-fetches the user and their memberships from the database on every call,
resolves the workspace this sign-in has open, and throws unless there is one,
returning a `CompanyUser` whose `companyId` is guaranteed non-null. Every query in `frontend/src/server/queries/` and every
action in `frontend/src/server/actions/` calls `requireMember()` (directly,
or transitively via `requireCan`/`requireAdmin`) and threads its
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
  the audit trail and scoring evidence are append-only from the app (the
  audit log is also append-only for every other role; see Audit log).
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
policy: users are identities rather than tenant data, and invites look up
users by email across workspaces. `Membership` is tenant data and has one,
and the policies on a user's sessions and second factors
(`LoginSession`, `TotpFactor`, `WebAuthnCredential`, `WebAuthnChallenge`,
`MfaRecoveryCode`) admit a row while its user is a member of the tenant,
wherever else they belong. `backend/tests/integration/rls.test.ts` fails if a new table with
a `companyId` lands without a policy. A new table that a tenant transaction
touches needs a `GRANT` in its migration, or the transaction fails with
`permission denied`.

**Membership lifecycle.** There are four ways to gain a membership:

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
   (the emailed link already proved the address); an existing account,
   whatever other workspaces it belongs to, accepts while signed in
   (`acceptInvite`, `backend/src/auth/workspaces.ts`). Re-inviting a pending
   email re-sends rather than erroring; revoking deletes the pending row;
   inviting someone already in the workspace is refused.
3. **Add a workspace** — `/onboarding` (`frontend/src/app/(auth)/onboarding/page.tsx`)
   is where a company-less account (a Google sign-up) lands, and where any
   signed-in user adds another workspace: accept a pending invite addressed
   to their email, or create a company (`createWorkspace`, at most five a
   day per account). The `(app)` layout redirects a signed-in user with no
   workspace to `/onboarding` before rendering the product shell.
4. **Single sign-on and directory sync** — an auto-join domain or a SCIM
   directory adds a membership to an existing account rather than refusing
   it (`sso/login.ts`, `sso/directory.ts`).

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
`requireCan` / `requireAdmin`) is wrapped in React `cache()`, so the
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
- **Integration** (`backend/tests/integration`, Vitest against a real
  Postgres) proves tenant isolation, the tenant-scoped client, the scoring
  queue, rate limits and the keyset pagination paths.
- **Scoring eval** (`backend/evals/scoring`, `npm run eval:scoring`) measures
  the model, not the code: see below.
- **End-to-end** (`frontend/tests/e2e`, Playwright, `playwright.config.ts`)
  drives the real app on port 3105:
  - the golden path and avatar upload;
  - viewer permissions (write affordances hidden, write-only routes redirect);
  - an admin inviting and revoking, and an invitee joining through the emailed
    link with the invited role;
  - scoring's named failure when no model is configured;
  - another tenant's records rendering as not-found.

  Fixtures in `tests/e2e/support` write state the UI can't produce in a test
  (a second tenant, an invite whose token is known) straight to the
  database, and clean up after themselves. In CI the suite runs against the
  production build (`next start`), so prerendered shells and the cache layer
  are what get tested. Locally it boots `next dev`.

### Scoring eval

Unit tests can prove the pipeline handles whatever the model returns. They
can't tell whether its verdicts are any good, so the eval measures that
against human labels.

- **Golden set** (`golden.json`, versioned). 16 synthetic cases, 41
  judgments, across engineering, healthcare, support, sales and security.
  Each requirement is labelled STRONG/PARTIAL/MISSING, and every supporting
  label lists the resume passages that justify it. Three cases are
  injection attempts. A case belongs only if two careful recruiters would
  agree on every label. `dataset.ts` validates the file (every requirement
  labelled once, spans present and really in the resume) in the unit
  suite, so a labelling mistake fails fast without a model call. The
  injection detector's recall and false-positive rate on the set are also
  unit-tested, since it is deterministic.
- **Metrics** (`metrics.ts`, unit-tested):
  - Cohen's κ and accuracy of final verdicts against labels, plus a
    confusion matrix.
  - Evidence precision (cited quotes found in the resume), relevance
    (verified quotes that cite a labelled passage) and STRONG evidence
    recall.
  - Score MAE against the score the labels imply.
  - Injection recall and false positives.
  - Stability: requirements whose verdict was identical across
    `--repeats`.
- **Gate.** κ ≥ 0.6, evidence precision ≥ 0.9, every injection case
  flagged, no clean case flagged, and κ no more than 0.08 below the
  committed `baseline.json` when the golden set version matches. With
  nothing changed, single passes measured 0.04 apart, so the tolerance sits
  above that noise, and CI pools two passes as the baseline does. The
  report lists every verdict that moved since the baseline.
- **CI** (`.github/workflows/scoring-eval.yml`) runs on PRs touching the
  engine, `ai/*`, the scoring schema or the eval itself. It writes the
  report to the job summary and uploads the full per-judgment JSON. Without
  a `GROQ_API_KEY` secret (e.g. fork PRs) it is skipped with a notice. The
  runner waits out provider rate limits, which free-tier keys hit within
  one pass.

**Baseline** (`openai/gpt-oss-120b`, prompt `576b4a5b7910`, two passes):
κ 0.884, accuracy 92.7%, evidence precision, relevance and STRONG recall
all 100%, score MAE 4.9, injection recall 100% with no false positives,
95.1% stability. Every miss is a PARTIAL label scored MISSING: the model
under-credits adjacent experience (an AWS Associate certification against
a Professional requirement, Oracle RAC against PostgreSQL operations).
That is the first thing a prompt change should target.

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

`next.config.ts` sets `Strict-Transport-Security` (2-year max-age, includes
subdomains, preload), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and a locked-down
`Permissions-Policy` (camera/microphone/geolocation all denied) on every route.

The `Content-Security-Policy` is built in one place, `frontend/src/lib/csp.ts`,
and allows no inline script anywhere:

- **Pages** get a per-request nonce. `src/proxy.ts` runs on every page and page
  data request, mints 128 random bits, puts the policy on both the request and
  the response, and passes the nonce on in `x-nonce`.
  `script-src 'self' 'nonce-…' 'strict-dynamic'`: Next reads the nonce from the
  request's policy and stamps it on every script it renders, the nonced runtime
  may load its own chunks, and the root layout hands the nonce to next-themes'
  pre-paint theme script. `'unsafe-eval'` is added in development only (React's
  error-stack reconstruction).
- **Every page renders per request.** A prerendered shell would carry scripts
  without the request's nonce, so the root layout reads it inside a
  `<Suspense>` that wraps `<html>`; the static shell is empty and `use cache`
  data caching is unaffected. This costs the marketing page its CDN-cached
  shell, a deliberate trade for a policy pen tests accept.
- **API routes** render no React and get a fixed policy with
  `script-src 'self'` (`next.config.ts`).
- **SAML POST binding.** `/api/oauth/authorize` may return the SSO service's
  auto-submitting form, which uses an `onload` attribute and a one-line inline
  script. Its policy allows exactly those two snippets by SHA-256
  (`'unsafe-hashes'` covers only the `onload` hash) and lets the form post to any
  `https:` host, since that is the tenant's IdP. If a library upgrade changes
  the snippets, the page falls back to its visible Continue button.

`style-src` keeps `'unsafe-inline'`: React server-renders `style` attributes
(status chips, motion initial states) and styles cannot run script. `img-src`
allows `blob:`, `data:` and Google's avatar CDN (`lh3.googleusercontent.com`),
`object-src 'none'`, `base-uri 'self'`, and `frame-ancestors 'none'` blocks
framing. Zod is configured `jitless` in the browser (`lib/zod-jitless.ts`), so
its `new Function` capability probe doesn't file a violation on form pages.
