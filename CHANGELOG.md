# Changelog

All notable changes to ResumeRank are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Restructured into an npm-workspaces monorepo: framework-agnostic domain code (Prisma, validators, scoring, auth helpers, email, rate limiting, activity log) moved to a `@resumerank/core` package under `backend/`; the Next.js app lives in `frontend/` and imports it by name. Server actions, Auth.js, and RSC are unchanged.
- Adopted a two-tone "ink + lime" design system as the source of truth: warm cream / near-black surfaces, semantic verdict and pipeline-stage color tokens, and a new type system (Instrument Sans, Space Grotesk, Fredoka, JetBrains Mono).
- Rebuilt the marketing landing page with GSAP + Lenis scroll choreography (split-word reveals, parallax, a pinned three-step demo, marquee, magnetic buttons), gated on `prefers-reduced-motion`.
- Restyled the signed-in shell: dark sidebar, Fredoka headings, mono uppercase table headers and status chips, pill buttons, and larger card radii.

### Added

- Sliding lime nav indicator: follows hover across the landing nav (resting on the primary CTA) and travels to the active section in the app sidebar.
- Backend unit tests for role capabilities (write/admin) alongside the existing scoring, parsing, validator, and rate-limit suites.
- Playwright golden-path E2E: sign in → dashboard → a job's ranked applicant pipeline.

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
