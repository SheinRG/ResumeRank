# Contributing to ResumeRank

Thanks for taking an interest. This project is a solo-built portfolio product, but issues and PRs are welcome.

## Local setup

Follow the Quick Start in the [README](README.md): clone, `cp .env.example .env`, fill in `DATABASE_URL` and `AUTH_SECRET`, then

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Before you push

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

All four must pass — CI runs the same checks on every push and PR.

## Branches & commits

- Branch from `main`: `feat/short-name`, `fix/short-name`, `docs/short-name`.
- Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Keep commits small and atomic — one logical change each.
- Rebase on `main` before opening the PR.

## Pull requests

- Describe **what changed and why**, not just what.
- Screenshots for any UI change (light and dark mode).
- New behavior needs a test; changed behavior needs the test updated in the same PR.

## Code conventions

The short version (see `AGENTS.md` for the full rules):

- TypeScript strict — no `any`.
- Validation lives in `backend/src/validators` (`@resumerank/core/validators`) and is shared by client and server. Never add ad-hoc validation.
- Every mutation goes through a server action with an auth guard — `requireWriter`/`requireAdmin`, which both call the tenancy guard `requireMember` — and an activity-log entry.
- UI uses the primitives in `frontend/src/components/ui`; spacing stays on the 4/8px scale.
