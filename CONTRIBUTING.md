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
npm run test:integration
npm run build
```

All five must pass — CI runs the same checks on every push and PR.

### Integration tests

`npm run test:integration` runs the backend services against a real Postgres and proves tenant isolation: two workspaces are seeded and every service is probed with the other tenant's ids. It needs a **disposable** database in `TEST_DATABASE_URL` (in `.env` or the shell) — the suite applies migrations to it and writes and deletes rows, and it never falls back to `DATABASE_URL`:

```bash
docker run --name resumerank-test-db   -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=resumerank_test   -p 5434:5432 -d postgres:16-alpine

# .env
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5434/resumerank_test"
```

When a migration needs hand edits Prisma can't express (generated columns, `NULLS LAST` indexes), declare the matching shape in `schema.prisma` and check for drift with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` (from `backend/`, with an empty scratch database in `SHADOW_DATABASE_URL`); it should report an empty migration.

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
