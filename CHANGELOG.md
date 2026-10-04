# Changelog

All notable changes to ResumeRank are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Login throttling now applies to every sign-in path. Previously it ran only
  in the login form, so posting to the Auth.js credentials endpoint directly
  allowed unlimited password guesses.
- Rate limits are shared across all server instances (previously each
  instance counted separately) and key on a client IP that can't be spoofed
  with an `X-Forwarded-For` header.

### Added

- Temporary account lockout after 10 failed sign-ins in 15 minutes, with a
  message saying how long to wait.
- Per-company AI token budget over a rolling 30 days, shown under
  Settings, Company.

- Background AI scoring: "Score with AI" queues the work and returns
  immediately; the page follows the run (Queued, Scoring, result) and picks
  it back up after a reload. Transient provider failures retry with backoff.
- "Score all unscored" on a job scores every unscored applicant in one click,
  with live progress; ranked rows show Queued/Scoring while in flight.
- Score history: rescoring keeps every earlier score and its evidence, listed
  on the application page.
- Unchanged inputs are never rescored: an applicant whose resume, rubric,
  model and prompt match an earlier result reuses it at no cost.
- `GET /api/health` for uptime monitors; structured JSON logs and
  OpenTelemetry traces, including LLM latency and token usage.

- AI autofill on the add-candidate form: an "Autofill from resume" action extracts the candidate's name, email, and a synthesized headline from the pasted resume text via Groq, pre-filling the intake fields for review. Extracted emails are dropped unless they appear verbatim in the resume, matching the scoring engine's anti-hallucination checks.

## [1.1.0] - 2026-07-23

### Added

- Multi-tenancy: a new `Company` model (name, slug, logo, website,
  description, industry, size, location) and row-level `companyId` scoping on
  `Job`, `Candidate`, `Application`, and `ActivityLog` (nullable on `User`
  until onboarding). Every server query/action is scoped to the caller's
  company through a new `requireMember()` guard; `Candidate.email` is now
  unique per company instead of globally.
- Company registration: `/register` now creates the registrant's own company
  and makes them its OWNER, replacing the single shared workspace.
- Team invites: admins/owners invite teammates by email + role from
  `/settings/team` (pending list, revoke, re-invite); invitees accept at
  `/invite?token=...` — new emails get a name + password form, existing
  company-less accounts can accept while signed in.
- Onboarding flow (`/onboarding`) for Google sign-ins with no company: accept
  a pending invite or create a new company.
- `/settings/company` page: admins/owners edit the company profile; members
  see it read-only. Company name and logo now show in the sidebar.
- Migration `20260723054528_add_company_multi_tenancy` backfills pre-existing
  single-tenant data into a "Default Company" so upgrading an existing
  deployment doesn't orphan any rows.
- Seed now creates a demo company, "Acme Talent"; demo login is unchanged
  (`demo@resumerank.app` / `demo1234`).
- Sliding lime nav indicator: follows hover across the landing nav (resting on the primary CTA) and travels to the active section in the app sidebar.
- Backend unit tests for role capabilities (write/admin) alongside the existing scoring, parsing, validator, and rate-limit suites.
- Playwright golden-path E2E: sign in → dashboard → a job's ranked applicant pipeline.

### Changed

- Restructured into an npm-workspaces monorepo: framework-agnostic domain code (Prisma, validators, scoring, auth helpers, email, rate limiting, activity log) moved to a `@resumerank/core` package under `backend/`; the Next.js app lives in `frontend/` and imports it by name. Server actions, Auth.js, and RSC are unchanged.
- Adopted a two-tone "ink + lime" design system as the source of truth: warm cream / near-black surfaces, semantic verdict and pipeline-stage color tokens, and a new type system (Instrument Sans, Space Grotesk, Fredoka, JetBrains Mono).
- Rebuilt the marketing landing page with GSAP + Lenis scroll choreography (split-word reveals, parallax, a pinned three-step demo, marquee, magnetic buttons), gated on `prefers-reduced-motion`.
- Restyled the signed-in shell: dark sidebar, Fredoka headings, mono uppercase table headers and status chips, pill buttons, and larger card radii.

## [1.0.0] - 2026-07-11

### Added

- Jobs with structured, weighted requirements (must-have / nice-to-have) as the scoring rubric.
- Candidates with pasted resume text and source tracking.
- Applications pipeline: new → screening → shortlisted → interview → offer → hired / rejected, with soft delete and undo.
- Explainable AI scoring via Groq: per-requirement verdicts (strong / partial / missing) with verbatim evidence quotes verified against the resume, gap notes, and a weighted 0–100 score.
- Auth: email/password with verification, Google OAuth, password reset, and server-enforced roles (owner / admin / member / viewer).
- Server-side search, filtering, sorting, and pagination mirrored to the URL; CSV export of candidates.
- Dashboard with pipeline funnel, score distribution, and volume-over-time charts.
- Reviewer scorecards (1–5 rating + notes) alongside AI evaluations.
- Immutable activity log of every mutation, queryable per entity.
- Command palette (Cmd/Ctrl+K), dark mode, keyboard-first navigation.
