# Changelog

All notable changes to ResumeRank are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
