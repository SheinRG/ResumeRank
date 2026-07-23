# ResumeRank — Build Plan

> **Pitch:** ResumeRank scores every applicant against your job's actual requirements — with quoted evidence and explicit gaps — so a recruiter can shortlist in under 60 seconds without trusting a black box.

## Who it's for

An in-house recruiter or founder staring at a pile of resumes who needs to decide **who to shortlist and why** — fast, and defensibly. Generic ATSs give a number; ResumeRank shows its work: every requirement mapped to a verdict, a quote from the resume as evidence, and a note naming the gap when there isn't one.

## User stories

1. **As a recruiter**, I create a job with a description and a structured requirement list (each marked must-have or nice-to-have), so scoring has an explicit rubric.
2. **As a recruiter**, I add candidates by pasting resume text, so I don't need a parsing pipeline to start screening.
3. **As a recruiter**, I attach candidates to a job (an *application*) and move them through a pipeline: new → screening → shortlisted → interview → offer → hired / rejected.
4. **As a recruiter**, I click **Score with AI** and get a 0–100 score *plus* a requirement-by-requirement breakdown: matched / partial / missing, evidence quoted from the resume, and a note explaining each verdict.
5. **As a recruiter**, I open a job and see candidates ranked by score, filterable by stage and searchable by name — and I can shortlist the top ones in a couple of clicks.
6. **As a hiring teammate**, I leave a scorecard (1–5 rating + notes) on an application so human judgment sits beside the AI's.
7. **As an admin**, I manage team roles (owner / admin / member / viewer); viewers can look but never write.
8. **As an owner**, I audit who changed what via an immutable activity log.
9. **As any user**, I see a dashboard: pipeline health, score distribution, and volume over time.

## Acceptance criteria by milestone

### M1 — Schema, auth, RBAC
- [ ] Prisma schema migrated against Postgres; seed script produces a realistic demo workspace.
- [ ] Email/password signup (bcrypt cost 12) with email verification required before write access.
- [ ] Google OAuth via Auth.js; OAuth emails are treated as verified.
- [ ] Password reset: single-use token, hashed at rest, 30 min TTL, invalidated on use.
- [ ] Login/reset rate-limited (~5 attempts / 15 min per IP+account).
- [ ] RBAC enforced **server-side** in every action; client-sent roles are never trusted.
- [ ] Sessions in httpOnly/Secure/SameSite=Lax cookies (Auth.js JWT strategy).

### M2 — Core CRUD + pipeline
- [ ] Jobs: create/edit/archive with structured requirements (label, must/nice weight, drag order preserved).
- [ ] Candidates: create/edit/delete with resume text and source.
- [ ] Applications: attach candidate↔job (unique pair), stage transitions with optimistic UI + rollback toast.
- [ ] Soft delete (`deletedAt`) on applications with undo.
- [ ] Every mutation validated by the same Zod schema on client and server; returns the mutated record.
- [ ] Every list/detail view resolves to loading / empty / error / success. Empty states have a CTA.
- [ ] Every mutation logs to ActivityLog.

### M3 — Finding data
- [ ] Server-side search (debounced ~300 ms) on jobs and candidates.
- [ ] Filters combine with AND semantics and mirror into the URL (shareable, back-button safe).
- [ ] Sorts on indexed columns with stable secondary sort on `id`.
- [ ] Pagination, page size 25; "no matches" (with one-click reset) distinguished from "no data yet".
- [ ] CSV export of the candidate table.

### M4 — AI scoring (the differentiator)
- [ ] Scoring runs against Groq with a strict JSON contract, parsed by Zod; malformed output → actionable error, no partial writes.
- [ ] Each requirement produces an Evaluation row: verdict (strong / partial / missing), evidence quoted from the resume, and a note.
- [ ] `aiScore` = weighted match percentage (must-haves weigh 2× nice-to-haves; partial = half credit).
- [ ] Report view shows score, per-requirement breakdown, evidence quotes, and explicit gaps.
- [ ] Rescoring replaces evaluations transactionally; a missing GROQ_API_KEY degrades to a clear message, never a crash.

### M5 — Dashboard
- [ ] Stat cards (open jobs, candidates, in pipeline, avg score) + three charts (pipeline funnel, score distribution, applications over time) on real data via recharts.
- [ ] Activity log page, filterable by entity.

### M6 — SEO, docs, CI
- [ ] Landing page with real copy, OG image (1200×630), sitemap, robots, JSON-LD (SoftwareApplication + FAQPage), canonical URLs.
- [ ] Security headers (CSP, HSTS, X-Content-Type-Options).
- [ ] CI: lint + typecheck + unit tests + build on every push.
- [ ] README (pitch, screenshots, quick start, env table, demo login), architecture.md, CONTRIBUTING, CHANGELOG, LICENSE.

### M7 — Case study
- [ ] docs/case-study.md: problem, approach, trade-offs, result, learnings.

## Data model

```
User          id, name, email, emailVerified, passwordHash?, image?, role(OWNER|ADMIN|MEMBER|VIEWER)
Account/Session/VerificationToken   — Auth.js
PasswordResetToken   userId, tokenHash, expiresAt, usedAt?
Job           id, title, description, location?, employmentType, status(DRAFT|OPEN|CLOSED|ARCHIVED), createdById
JobRequirement id, jobId, label, weight(MUST|NICE), order
Candidate     id, name, email, headline?, source(MANUAL|REFERRAL|JOB_BOARD|OUTREACH|OTHER), resumeText, createdById
Application   id, jobId+candidateId (unique), stage(NEW|SCREENING|SHORTLISTED|INTERVIEW|OFFER|HIRED|REJECTED),
              aiScore?, aiSummary?, scoredAt?, deletedAt?, createdById
Evaluation    id, applicationId, requirementId?, criterion, verdict(STRONG|PARTIAL|MISSING), evidence?, note, weight
Scorecard     id, applicationId+reviewerId (unique), rating 1..5, notes?
ActivityLog   id, actorId, action, entityType, entityId, summary, metadata Json?, createdAt  (append-only)
```

Notes on refinements vs. the brief:
- `Evaluation.matched: bool` → `verdict: STRONG | PARTIAL | MISSING`. A boolean can't express "has 2 of the 4 required years" — partial credit is where explainability earns its keep.
- Requirements are first-class rows (`JobRequirement`), not a JSON blob, so evaluations can foreign-key the exact requirement they judge and reordering/weighting is queryable.
- `resumeFileUrl` is deferred (see assumptions); `resumeText` is the scoring source of truth either way.

## Key edge cases

- Resume text too short/empty → block scoring with a named fix ("add at least 200 characters of resume text").
- LLM returns malformed JSON or hallucinates requirement IDs → Zod rejects, evaluations unchanged, user sees retry.
- Duplicate application (same candidate + job) → unique constraint surfaces as a friendly inline error.
- Stage move raced by another user → server is source of truth; optimistic UI rolls back with a toast.
- Job with zero requirements → scoring disabled with inline explanation and a link to add requirements.
- Unverified email → read access only; writes return a "verify your email" error server-side (not just hidden buttons).
- Viewer role → all mutation actions rejected server-side; UI also hides affordances.
- Deleting a candidate with applications → confirm dialog names the blast radius; applications soft-deleted.
- Search with no matches vs. empty workspace → different empty states; the former gets "clear filters".
- Groq rate limit / timeout → error state with retry; the app never blocks on the LLM for navigation.

## Explicit assumptions

1. **One-shot build:** the reviewer instructed a full build in one pass, overriding the plan-gate in the original brief. plan.md is written first, then implementation follows immediately.
2. **Single shared workspace, at the time this plan was written:** all users belonged to one implicit team (roles differentiate power) and multi-tenant orgs were named as roadmap. That roadmap item has since shipped — see `docs/architecture.md`'s Multi-tenancy section: each company registers its own isolated workspace on shared Postgres, scoped by `companyId`.
3. **Resume as pasted text:** file upload + parsing (PDF/DOCX) is deferred; `resumeText` is the scoring input. This keeps the trial's 60-second core flow friction-free and the parsing failure surface out of scope.
4. **Email delivery:** Resend is used when `RESEND_API_KEY` is set; otherwise verification/reset links are logged to the server console (documented in README). Seeded demo users are pre-verified so reviewers never need email.
5. **Rate limiting** is an in-process token bucket — correct on a single serverless instance per region; a Redis-backed limiter is the named production upgrade.
6. **Groq model:** `llama-3.3-70b-versatile` with JSON response format; model name is env-configurable.
7. **First registered user becomes OWNER, at the time this plan was written:** since multi-tenancy shipped, every registration creates a new company and its registrant is that company's OWNER — there's no shared workspace for a "first user" to be first in. Joining an existing company happens only via an emailed invite (see `docs/architecture.md`).

## Open questions (proceeding with the defaults above)

- Should scoring auto-run when an application is created? **Default: no** — explicit "Score" action keeps token spend visible and the pending state honest.
- Custom domain for deployment? **Default: `*.vercel.app`** subdomain.
