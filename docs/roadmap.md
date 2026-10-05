# ResumeRank — Enterprise & Scale Roadmap

> Moving ResumeRank from a well-built single-deployment product to a SaaS that large clients can buy, procure, and run at volume (10k+ candidates per tenant, hundreds of recruiters, many tenants).

Source: four parallel read-only audits (data/tenancy, AI pipeline, identity & enterprise, infra/ops) run on 2026-10-02 against `main` @ `6b6674d`. Critical findings were spot-checked against the code. Line numbers refer to that commit and will drift — re-verify before acting.

## Where we stand

**Strong already:** DB-rechecking guards on every request (`frontend/src/lib/auth/guards.ts:36-89`), consistent `companyId` scoping in every query in `frontend/src/server/queries`, shared Zod validation, fail-fast env validation (`backend/src/env.ts`), JSON-mode LLM output with Zod parsing + one corrective retry, transactional evaluation replacement, fabricated-quote stripping (`backend/src/scoring/parse.ts:52-61`), SQL-side dashboard aggregates, security headers (`frontend/next.config.ts:9-28`), loading skeletons on every app route.

**No cross-tenant read leak was found.** Gaps sit outside the guard pattern (backend functions, bulk updates, audit-log deletion) and in everything operational: observability, background work, enterprise identity, billing, compliance, data at scale.

---

## Phase 0 — Fix before any paying customer (≈1 week)

Trust-breaking defects, mostly small.

- [x] **Audit log is deletable.** `frontend/src/server/actions/users.ts:305` runs `tx.activityLog.deleteMany({ where: { actorId } })` on account deletion, erasing the user's history from the company audit trail. Company deletion also cascades the log away. → Keep rows; make `actorId` nullable / point to a tombstone user and anonymise. Revoke UPDATE/DELETE on `ActivityLog` from the app DB role.
- [x] **Unscoped bulk reassignment.** `users.ts:292-303` — `job/candidate/application.updateMany({ where: { createdById } })` with no `companyId` filter; `createdById` is unindexed so each is a full cross-tenant table scan inside a transaction. → Add `companyId: currentUser.companyId` to each `where`; index `createdById`.
- [x] **Scoring engine not tenant-scoped.** `backend/src/scoring/engine.ts:123` loads `application.findUnique({ where: { id } })`; `:169`/`:183` replace evaluations by `applicationId` alone. Safe only because `frontend/src/server/actions/scoring.ts:25` pre-checks. A queue worker would bypass tenancy. → Make `companyId` a required parameter and include it in every `where`.
- [x] **No member removal.** No action removes a teammate; `team-table.tsx` only offers a role select. Demoting to VIEWER still grants read + export. Fails SOC 2 offboarding (CC6.2/6.3). → Guarded, tenant-scoped, logged `removeMemberAction` (sets `companyId: null`, bumps session version).
- [x] **CSV export.** `frontend/src/app/(app)/candidates/export/route.ts:9` gated only by `requireMember` (VIEWER can bulk-export PII); not activity-logged; silently capped at 1000 rows (`frontend/src/server/queries/candidates.ts:156`); `csvField` (`:143`) doesn't neutralise leading `= + - @` (formula injection); `route.ts:12` returns raw `error.message`. → `requireWriter`, `logActivity`, cursor-streamed export, escape formula prefixes, generic error.
- [x] **Dangerous account linking.** `frontend/src/lib/auth/index.ts:36` — `Google({ allowDangerousEmailAccountLinking: true })` lets a Google identity take over a same-email password account. → Disable, or allow only after verified-email confirmation flow.
- [x] **JWT sessions cannot be revoked.** `strategy: "jwt"` (`index.ts:42`), no `maxAge`/`updateAge` (30-day default), password reset (`actions/auth.ts:198-219`) and change (`users.ts:177-181`) don't invalidate other sessions. `Session` model (`schema.prisma:146`) unused. → `User.sessionVersion` embedded in the JWT and checked in the `jwt` callback / guards; bump on password change/reset, removal, role change; shorter `maxAge`; "sign out all devices".
- [x] **Invite token not consumed atomically.** `consumeInviteToken` (`backend/src/auth/tokens.ts:120-130`) only reads; acceptance is marked later (`actions/company.ts:313-316`). → Mark consumed inside the signup transaction.
- [x] **HTML injection in invite emails.** `backend/src/email.ts:128-129` interpolates `companyName`/`inviterName` unescaped. → Escape all interpolated values.
- [x] **Unbounded AI spend.** `rateLimit` used only in `auth.ts`/`company.ts`. `scoreApplicationAction` and `extractCandidateProfileAction` (`actions/candidates.ts:139`) are unlimited; extraction checks only a min length (`:146`), skipping the 50k max in `validators/candidate.ts:24`. → Validate through the shared schema; per-user + per-tenant limits.
- [x] **Error boundary leaks messages.** `frontend/src/app/(app)/error.tsx:16` renders `error.message`. → Generic copy + `error.digest` as a support reference.
- [x] **Scorecard on removed application.** `actions/scorecards.ts:26` doesn't check `deletedAt`.
- [x] **Slug race.** `generateCompanySlug` (`backend/src/company.ts:26`) reads via `db` not `tx`; unhandled P2002 on concurrent registration. → Generate inside the tx and retry on conflict.

---

## Phase 1 — Production foundations (2–4 weeks)

### 1.1 Service layer extraction (highest leverage)
All business logic (tenancy filters, activity logging, scoring orchestration) lives in Next-bound `frontend/src/server/actions/*` and `queries/*`, coupled to `auth()` and `revalidatePath`. A public API, mobile client, or queue worker would have to duplicate it.

- [x] Create `@resumerank/core/services/*` taking an explicit `TenantContext { companyId, actorId, role }`.
- [x] Server actions, route handlers (API keys/webhooks), and workers become thin adapters: guard → build context → call service → revalidate.
- [x] Write `logActivity` **inside** the same `$transaction` as the mutation (today e.g. `scoring.ts:53` logs after the write — a failed log leaves an unaudited mutation).

### 1.2 Tenancy defense-in-depth
Isolation currently relies on developers remembering a `where` clause; Phase 0 items show it already slipping.

- [x] Prisma client extension `db.forTenant(companyId)` that injects/asserts `companyId` on `Job`, `Candidate`, `Application`, `ActivityLog`. → `backend/src/tenant-db.ts`: `forTenant` / memoised `tenantDb(ctx)`, used by every service; throws `TenantViolationError` on a mismatched filter, create, or row move. Does not reach nested relation writes or raw SQL — RLS closes that gap.
- [ ] Postgres RLS (deferred to a follow-up PR after the extension + integration tests land): `ENABLE ROW LEVEL SECURITY` + policy `"companyId" = current_setting('app.company_id')` on the four tenant tables; set via `set_config(..., true)` inside an interactive transaction; separate bypass role for auth/onboarding paths.
- [x] Integration test suite (vitest against the CI Postgres service): seed two companies; assert every query and action returns not-found for the other tenant's ids. → `backend/tests/integration` (`npm run test:integration`, `TEST_DATABASE_URL`): every service probed with the other tenant's ids, then the other tenant's rows compared unchanged; extension behaviour (incl. inside interactive transactions) tested against the real DB. Server actions are covered through the services they wrap.
- [x] Remove reliance on check-then-write ordering: `actions/jobs.ts:81,95,100` (`JobRequirement` by `jobId`/`id` only), `users.ts:67` (update by `id` after a separate `findFirst`).

### 1.3 Observability (currently none)
Only sink is `console.error("[action]", error)` (`frontend/src/server/run-action.ts:18`) with no request/user/company context.

- [x] `frontend/src/instrumentation.ts` with `register()` (OpenTelemetry/Sentry) and `onRequestError`. → `@vercel/otel` (vendor-neutral OTLP); `onRequestError` writes a `request.error` line keyed by digest.
- [x] `app/global-error.tsx`.
- [x] `runAction` takes an action name; logs structured JSON `{action, companyId, userId, digest, durationMs}` and captures exceptions. → `@resumerank/core/observability/log` + AsyncLocalStorage context the guards annotate; the generic error message carries the digest.
- [x] Instrument LLM calls: latency, tokens, retries, failures (`engine.ts:74-94`, `extraction/engine.ts:67`). → `traceLlmCall`: GenAI-convention spans + `llm.call` / `llm.output_rejected` log lines.
- [x] `/api/health` (DB `SELECT 1`) for uptime monitors. → bounded at 5s (Neon cold start ≈2s), no failure detail in the response.

### 1.4 Async AI pipeline
Scoring is synchronous: `scoring.ts:45` awaits up to two sequential Groq calls (`max_tokens: 4096`, `engine.ts:74-92`) with no timeout, AbortSignal, or `maxDuration`. No bulk scoring — 300 applicants = 300 clicks. Rescoring destroys history (`engine.ts:169` `deleteMany`).

- [x] `ScoringRun` model: `status (QUEUED|RUNNING|SUCCEEDED|FAILED)`, `model`, `promptVersion`, `temperature`, `inputHash` (resumeText + requirement set + model + prompt version), `promptTokens`, `completionTokens`, `latencyMs`, `rawOutput`, `actorId`, `companyId`.
- [x] Evaluations append-only, attached to a run; `Application.latestScoringRunId` is a pointer. → existing scores migrated into one `legacy` run each.
- [x] Durable queue/workflow (Vercel Workflow/Queues, Inngest, or BullMQ): idempotency by `inputHash`, exponential backoff on 429/5xx, per-tenant + global concurrency caps. → a Postgres queue (the `ScoringRun` table; advisory-locked claims make the caps exact; drained via `after()`, status polls and `/api/cron/scoring`), no new vendor. See `docs/architecture.md` (Scoring pipeline).
- [x] "Score all unscored for job X" bulk action; UI polls/streams job status instead of blocking `useTransition` (`score-button.tsx:33`).
- [x] Dedup/cache: skip the LLM when `inputHash` already has a successful run.
- [ ] (Next, on the same queue pattern.) Same treatment for email: outbox table + queued sender with retries, bounce/complaint webhooks (today `email.ts:64-78` is awaited inline in `auth.ts:80,169,192`, `company.ts:216`).

### 1.5 Distributed rate limiting & quotas
`backend/src/rate-limit.ts:6-11` is in-process memory (effective limit ≈ N instances × max, resets on cold start). IP key is the first `x-forwarded-for` value (`actions/auth.ts:28`) — spoofable unless the platform overwrites it.

- [x] Upstash Redis sliding window (or Vercel WAF rate limits). → Postgres sliding window instead (`RateLimitCounter`, one atomic statement per check), no new vendor. See `docs/architecture.md` (Rate limiting).
- [x] Use the platform's trusted client-IP header. → `x-vercel-forwarded-for` on Vercel, `TRUSTED_IP_HEADER` elsewhere, else the last `X-Forwarded-For` hop.
- [x] Per-tenant LLM token budget + per-user limits on scoring/extraction; account lockout after repeated failures. → login throttling moved into `authorize()`, which also closed a bypass via `POST /api/auth/callback/credentials`.

### 1.6 Data layer at scale
- [x] **Indexes for default views.** `Job(companyId, status, createdAt DESC, id)` / `Application(companyId, stage, createdAt DESC, id)` put the optional filter second, so unfiltered lists (`queries/jobs.ts:87`) and dashboard aggregates (`dashboard.ts:120-140`) sort the whole tenant in memory. → Add `(companyId, createdAt DESC, id)` on Job and Application; `WHERE "deletedAt" IS NULL` partial indexes on Application. → `(companyId, createdAt DESC, id DESC)` on Job, Candidate, ActivityLog and (partial) Application, plus partial `(jobId, createdAt DESC, id DESC)`, `(companyId, stage)` and `(companyId, aiScore)` on Application; `(companyId, entityType, createdAt DESC, id DESC)` for the filtered activity log. Migration `20261006090000_data_layer_at_scale`.
- [x] **Score sort index.** `queries/applications.ts:97` sorts `aiScore DESC NULLS LAST` but the index `(jobId, deletedAt, stage, aiScore DESC)` is NULLS FIRST with `stage` in front. → Raw-SQL partial index `(jobId, aiScore DESC NULLS LAST, id) WHERE "deletedAt" IS NULL`. → Declared in the schema with `partialIndexes`, `NULLS LAST` hand-added in the migration (Prisma's diff ignores null ordering, so no drift).
- [x] **Keyset pagination.** Offset + `count(*)` per page in `activity.ts:35,48`, `candidates.ts:81,94`, `applications.ts:107,120`, `jobs.ts:77,90`. ActivityLog grows without bound. → Cursors on `(createdAt, id)`; estimated or capped counts. → `after`/`before` cursors on every list (`backend/src/services/pagination.ts`), tie-breaker in the key's direction so one index serves Next and Prev; counts capped at 1,000 ("1,000+"). See `docs/architecture.md` (Data layer).
- [x] **Search.** `ILIKE '%q%'` across name/email/headline (`candidates.ts:58-60`, `applications.ts:83-84`, `jobs.ts:59`) can't use btree indexes and can't search resume text. → `pg_trgm` GIN on name/email/headline; `tsvector` generated column + GIN on `resumeText`. → Trigram GIN on candidate name/email/headline and job title; generated `Candidate.resumeTsv` + GIN, matched with `websearch_to_tsquery` in the candidate list and CSV export.
- [x] **Missing FK indexes:** `Job/Candidate/Application.createdById`, `ActivityLog.actorId`, `Scorecard.reviewerId`, `Evaluation.requirementId`, `CompanyInvite.invitedById`; plus `CompanyInvite(email)` (queried at `onboarding/page.tsx:39`; unique index is `(companyId, email)`). → All added (`ActivityLog.actorId` already existed).
- [x] **Unbounded loads.** `listCandidateOptions` (`candidates.ts:136`) ships every tenant candidate to the job page (`jobs/[id]/page.tsx:69`) → server-side search combobox with limit. `dashboard.ts:140` pulls 8 weeks of application rows into JS → `date_trunc('week')` GROUP BY. Requirement updates loop one-by-one in a tx (`actions/jobs.ts:98-114`) → batch. → `GET /api/jobs/[id]/candidate-options` typeahead (20 per query, skips candidates already in the pipeline); weekly chart is a `date_trunc('week')` GROUP BY; requirement edits are one `UPDATE … FROM (VALUES …)` plus one `createMany`.
- [x] **Select explicitly.** `include: { candidate: true }` (`applications.ts:160`) drags full `resumeText` everywhere. → `getApplication` selects candidate fields explicitly and returns a SQL-computed `resumeLength` instead of the text.
- [x] **Connection pooling.** `backend/src/db.ts:8` uses the default `pg` pool (10) per instance. → Pool `max` 1–3 on serverless, require the pooled (PgBouncer/Neon) URL at runtime, `DIRECT_URL` for migrations, `statement_timeout`. → `DATABASE_POOL_MAX` (default 3 on Vercel, 10 elsewhere), `DATABASE_STATEMENT_TIMEOUT_MS` (default 15s), `DIRECT_URL` preferred by `prisma.config.ts`; the app warns at startup on Vercel without `DIRECT_URL` instead of refusing to boot.
- [x] **Soft-delete consistency.** Only Application has `deletedAt`; jobs archive via status; candidates hard-delete. Pick one policy per entity and document it. → Kept as is, now a stated policy: applications soft-delete, jobs archive, candidates hard-delete (PII erasure), users hard-delete with anonymised activity. See `docs/architecture.md` (Deletion policy).

### 1.7 Caching
No `use cache` / `cacheTag` / `cacheComponents` anywhere; dashboard fires ~10 queries per load; layout calls `auth()` then `requireUser()` (another `auth()` + DB hit) and the page repeats it.

- [x] Wrap guards in React `cache()` so one request = one user lookup. → `requireUser` is `cache()`d, so the layout, page, metadata and queries share one session read and user query; the layout's separate `auth()` call is gone.
- [x] Enable Cache Components; `use cache` + `cacheTag(\`company:${id}:dashboard\`)` etc.; `updateTag` from mutations instead of path-wide `revalidatePath`. → Every route now prerenders a shell (signed-in and auth layouts stream behind matching skeletons). The dashboard is `use cache`d per user and tenant under `company:<id>:dashboard`; every activity-writing action `updateTag`s it, and the scoring drain `revalidateTag`s the tenants it scored. The lifetime is 30–60s because the default cache is per instance: shared invalidation needs a cache handler (see `docs/architecture.md`, Rendering and caching). Lists and detail pages stay uncached on purpose.

### 1.8 CI/CD & environments
`.github/workflows/ci.yml:48-52` runs `db:deploy` against an empty CI DB only; README says to migrate prod by hand.

- [ ] Deploy workflow: `prisma migrate deploy` against staging → prod before promotion; Neon branch-per-PR preview DBs.
- [ ] `prisma migrate diff --exit-code` drift check; documented expand/contract policy for destructive migrations.
- [ ] Run Playwright e2e in CI (seed + production `start`; `playwright.config.ts` currently boots `next dev`). Add specs for RBAC, invites, scoring, tenant isolation (only `golden-path` and `avatar-upload` exist).
- [ ] Dependabot, CodeQL, gitleaks, `npm audit`, bundle-size budget, concurrency cancel.
- [ ] Pin `next-auth` exactly (currently `^5.0.0-beta.31` on a security-critical beta).
- [ ] `APP_ENV` tiers in `.env.example`.
- [ ] Backups/DR: document Neon PITR window, RPO/RTO, restore runbook, periodic restore drill.

---

## Phase 2 — Enterprise must-haves (1–3 months)

Ranked by enterprise-deal impact.

1. [ ] **SSO per tenant (SAML/OIDC)** with SSO enforcement and verified-domain auto-join. Only Credentials + Google exist (`lib/auth/index.ts:11-38`). WorkOS or BoxyHQ is the fast path.
2. [ ] **SCIM 2.0** provisioning/deprovisioning (Okta, Azure AD).
3. [ ] **MFA** (TOTP / WebAuthn passkeys) + "require MFA" admin policy.
4. [ ] **Session management UI**: active sessions, revoke, configurable lifetime per tenant.
5. [ ] **Immutable, exportable audit log**: retention settings, CSV/JSON export, SIEM streaming; record auth events (login, failed login, MFA, SSO) and exports.
6. [ ] **Multi-company membership.** `User.companyId` is a single FK (`schema.prisma:69`); creating a second company is blocked (`company.ts:53-55`), as is inviting a user who belongs elsewhere (`company.ts:198`). → `Membership(userId, companyId, role)` join table, active-company switcher in session. Required for agencies/consultants/subsidiaries.
7. [ ] **Granular RBAC**: hiring-manager and interviewer roles, per-job access/assignment, department scoping, eventually custom roles. Today every member sees every candidate.
8. [ ] **Ownership transfer** as a dedicated flow (today promote-then-demote).
9. [ ] **Billing**: Stripe, plans, seats, AI usage metering (from `ScoringRun` tokens), entitlements, dunning. FAQ currently says "demo/trial project... no billing" (`faq-data.ts:37`).
10. [ ] **Feature flags / entitlements** keyed by `companyId` (Vercel Flags or OpenFeature) for per-tenant rollout and plan gating.
11. [ ] **Public REST API** with scoped API keys + **outbound webhooks** (application created, stage changed, scored). Integrations: HRIS, job boards, Slack, calendar. Only API route today is `app/api/auth/[...nextauth]`.
12. [ ] **Resume file ingestion**: blob storage with tenant-prefixed keys, async PDF/DOCX parsing (unpdf/mammoth, OCR fallback), keep original for audit; later email-in and job-board/ATS import. Today `Candidate.resumeText` is plain text only (`schema.prisma:219`).
13. [ ] **Nonce-based CSP** — drop `script-src 'unsafe-inline'` (`next.config.ts:13`); pen tests will flag it.
14. [ ] **Security program**: IP allowlisting, password policy settings, SOC 2 readiness (Vanta/Drata), pen test, security page + trust center.

---

## Phase 3 — Compliance & AI trust (the differentiator)

Hiring AI is **high-risk under the EU AI Act** (Annex III §4) and covered by **NYC Local Law 144**. Doing this well is a selling point, not overhead.

### Compliance
- [ ] Immutable scoring runs (Phase 1.4) → every historical score is reproducible and explainable.
- [ ] Decision log tying each human stage change to the AI output visible at that moment (human-oversight record).
- [ ] Optional PII / protected-attribute redaction before scoring (name, age, photo descriptions, etc.).
- [ ] Optional voluntary demographic self-ID, stored separately from scoring; selection-rate / impact-ratio reports for bias audits.
- [ ] Per-tenant candidate notice + opt-out / consent flags.
- [ ] Model card / AI documentation page; DPA covering the LLM sub-processor (resume PII goes to Groq).

### GDPR / data lifecycle
- [ ] Candidate erasure is incomplete: activity summaries embed names (`added candidate "${name}"`, `rated X 4/5`). → Store entity ids in the log, render names at read time (or redact on erasure).
- [ ] Data-subject access export per candidate.
- [ ] Per-tenant retention policy + auto-purge of candidates and AI outputs.
- [ ] Tenant offboarding: full export + deletion.
- [ ] Data residency: `Company.region`, per-region DB/cell routing.
- [ ] Consider column-level encryption for resume text / PII.

### Scoring quality & safety
- [ ] **Provider abstraction**: `LlmProvider` interface (or AI SDK / AI Gateway) with fallback model, circuit breaker, timeouts, shared retry/parse helper. Today `groq-sdk` is hardcoded, a client is created per call (`engine.ts:69`), and scoring/extraction duplicate the retry loop.
- [ ] **Prompt injection hardening**: strip/escape `<<<RESUME_END>>>`-style delimiters inside resume text; delimit job description and requirement labels too (`engine.ts:44-50`); heuristic/classifier flag surfaced to the recruiter.
- [ ] **Evidence integrity**: persist `quoteVerified`; NFKC + quote/ligature normalization before matching (PDF text will cause false negatives); downgrade STRONG-without-verified-evidence to PARTIAL (today an unverified quote is nulled but the verdict stands and still counts).
- [ ] **Determinism**: temperature 0 (currently 0.2, `engine.ts:77`) / seed; surface score variance.
- [ ] **Eval harness**: versioned golden set of labelled resume/requirement pairs; verdict agreement (κ), evidence precision, drift reports; gate prompt/model changes in CI.

---

## Later / Scale & polish

- [ ] Load testing (k6) for scoring and dashboard paths; nightly baseline.
- [ ] Internal staff backoffice: tenant search, suspension, audited impersonation, support tooling.
- [ ] Per-tenant subdomain / custom domain; white-labeling (branded emails, careers page). Only a logo URL exists today (`schema.prisma:91`).
- [ ] i18n + timezones: `"en-US"` hardcoded in `frontend/src/lib/format.ts:1,7`; no timezone on User/Company.
- [ ] Audit-log cold storage / partitioning for long-retention tenants.
- [ ] Reduce email surface (backend ships both `resend` and `nodemailer`).

---

## Recommended sequencing

1. Phase 0 sweep (one branch, one PR per concern).
2. Service-layer extraction (1.1) — makes everything after cheaper and testable.
3. Tenancy integration tests + Prisma tenant extension, then RLS (1.2).
4. Observability (1.3).
5. `ScoringRun` + queue + metering + distributed rate limits (1.4, 1.5).
6. Data-layer indexes, keyset pagination, search, pooling (1.6), then caching (1.7). CI/CD (1.8) in parallel.
7. SSO / SCIM / MFA / audit log (Phase 2 items 1–5).
8. Multi-company membership and granular RBAC (Phase 2 items 6–8).
9. Billing + feature flags + public API/webhooks + file ingestion (Phase 2 items 9–12).
10. Compliance & AI trust package (Phase 3).
