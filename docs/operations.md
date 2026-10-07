# Operations

How ResumeRank moves from a pull request to production, how schema changes
ship safely, and how to recover the database. The workflows live in
`.github/workflows/`; this page is the setup they expect and the policy they
enforce.

## Environments

| Tier | `APP_ENV` | Database | Deployed by |
| --- | --- | --- | --- |
| Local | `development` | Docker Postgres on 5433 | `npm run dev` |
| CI | `test` | Throwaway Postgres service per job | `ci.yml` |
| Pull request preview | `preview` | Neon branch `preview/pr-<n>` | Vercel preview + `preview-db.yml` |
| Staging | `staging` | Neon staging branch | `deploy.yml` (migrations) |
| Production | `production` | Neon primary branch | `deploy.yml` |

`APP_ENV` is independent of `NODE_ENV`: preview and staging builds still run
with `NODE_ENV=production`. It is validated at startup (`backend/src/env.ts`)
and stamped on every log line as `appEnv`, so logs from different tiers never
blur together in a shared drain.

## Pipelines

**`ci.yml`** runs on every pull request and every push to `main`. A newer push
to the same pull request cancels the older run.

- *verify*:
  1. the dependency audit gate
  2. lint, typecheck and unit tests
  3. the migration drift check
  4. migrations and the integration suite against a throwaway Postgres
  5. the production build
  6. the bundle-size budget
- *e2e*: migrates and seeds a fresh database, builds, serves the production
  build with `next start`, and runs the Playwright suite against it. A failed
  run uploads the Playwright report and traces as an artifact.

**`security.yml`** runs on pull requests, pushes to `main`, and weekly:

- CodeQL (`security-extended` queries);
- gitleaks over the full git history, so a secret that was committed and later
  deleted is still caught.

**`dependabot.yml`** opens weekly update PRs:

- minor and patch bumps are grouped into one PR; each major version gets its
  own PR;
- GitHub Actions versions are updated the same way;
- `next-auth` is excluded. It is pinned to an exact beta because it is
  security-critical and betas can change behaviour, so upgrade it by hand
  after reading its release notes.

**`deploy.yml`** runs on every push to `main`, in order:

1. `migrate-staging` applies migrations to staging.
2. `migrate-production` applies migrations to production.
3. `deploy-production` builds and deploys the code to Vercel.

Each step needs the one before it to succeed. Schema always lands before the
code that depends on it, and a migration that fails on staging never reaches
production. Deploys never run two at a time.

**`preview-db.yml`** gives every pull request its own Neon branch. The branch
is a copy-on-write clone of the parent branch's data. The workflow applies
the PR's migrations to it, checks that the result matches `schema.prisma`,
and deletes the branch when the PR closes. A migration is therefore proven
against production-shaped data before it merges.

### One-time setup

Until these are configured, `deploy.yml` and `preview-db.yml` succeed without
doing anything and say what is missing. Production keeps deploying through
Vercel's Git integration in the meantime.

In GitHub, open **Settings → Environments** and create two environments:

| Environment | Secret | Value |
| --- | --- | --- |
| `staging` | `DIRECT_URL` | Direct (unpooled) connection string of the Neon staging branch |
| `production` | `DIRECT_URL` | Direct (unpooled) connection string of the Neon primary branch |
| `production` | `VERCEL_TOKEN` | Optional. A Vercel token, to deploy from Actions; see below |

Add **required reviewers** to `production` if a person should approve each
production migration and deploy.

Under **Settings → Secrets and variables → Actions**, add:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `NEON_PROJECT_ID` | Neon project id; enables per-PR preview branches |
| Secret | `NEON_API_KEY` | Neon API key |
| Variable | `NEON_DB_NAME`, `NEON_DB_ROLE` | Only if not the defaults `neondb` / `neondb_owner` |
| Variable | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Required when `VERCEL_TOKEN` is set |

**Deploying from Actions.** Vercel's Git integration deploys `main` at the
same moment the workflow starts migrating, so the new code can briefly run
against the old schema. Setting `VERCEL_TOKEN` makes `deploy-production` the
only path to production, and deploys run strictly after migrations. In the
same change, stop Vercel from auto-deploying `main` (project settings, or
`"git": { "deploymentEnabled": { "main": false } }` in `vercel.json`).
Otherwise every merge deploys twice, once without waiting for migrations.

**Connection strings.** At runtime, `DATABASE_URL` is Neon's **pooled**
string. `DIRECT_URL` is the **direct** string; `prisma.config.ts` prefers it
for migrations, which need a session-level connection.

## Schema changes: expand, then contract

Old code keeps serving traffic while migrations run, and a deploy can be
rolled back without rolling back the schema. So every migration must work
with both the code before it and the code after it. A breaking change ships
as separate releases:

1. **Expand.** Add the new shape alongside the old one: a nullable column, a
   new table, an index (built `CONCURRENTLY` for large tables). Deploy code
   that writes both shapes and reads the old one.
2. **Migrate.** Backfill existing rows in batches, either in a migration or a
   one-off script, without long locks. Deploy code that reads the new shape.
3. **Contract.** Once no deployed code reads the old shape (at least one
   release later), drop it in its own migration.

Rules the reviewer checks:

- **Never in one release:**
  - dropping or renaming a column or table that the deployed code still uses;
  - adding `NOT NULL` without a default to a populated table;
  - changing a column's type in place.
- **Renames:** add the new column, copy the data, switch the code, then drop
  the old column across later releases.
- **Destructive migrations:** a migration that drops data says so in its PR
  title, and the PR states which earlier release stopped using the data.
- **Never edit an applied migration:** add a new one. The CI drift check
  (`npm run db:drift`) fails when `schema.prisma` and the migrations folder
  disagree.
- **Hand-edited SQL:** some shapes can't be expressed in Prisma (generated
  columns, `NULLS LAST` indexes). Declare the matching shape in the schema so
  the drift check stays empty; see CONTRIBUTING.

## Backups and disaster recovery

Neon keeps continuous point-in-time history for each project. Any moment
inside the project's **history retention** window can be restored. Check the
window under **Settings → Storage** in the Neon console. It depends on the
plan and is the hard limit on how far back you can recover. Keep it at least
as long as the RPO below needs, plus time to notice a problem.

| Objective | Target | Basis |
| --- | --- | --- |
| RPO (data loss) | ≤ 5 minutes | Point-in-time restore from continuous history |
| RTO (time to recover) | ≤ 1 hour | Branch restore plus a connection-string swap; no data copy |
| Restore reach | The project's history retention window | Neon plan setting |

Anything that needs a longer reach than the retention window, such as
compliance archives or protection against deleting the Neon project itself,
needs a separate logical backup, for example a scheduled `pg_dump` to object
storage.

### Restore runbook

Use this for bad data, such as a destructive migration or a bug that
corrupted rows. A full outage of the database host is Neon's incident, not
this runbook's.

1. **Stop the bleeding.** If writes are still corrupting data, pause the
   cause: roll back the deploy in Vercel, or disable the feature.
2. **Find the timestamp.** Pick the last known-good moment from the deploy
   time, the `action` log lines (every mutation is logged with its time), or
   the activity log.
3. **Restore into a new branch first.** In Neon, create a branch from the
   primary branch *at that timestamp*. Check it: row counts, the records you
   know were damaged, and `npm run db:drift` with `DIRECT_URL` pointing at it.
4. **Choose the recovery path:**
   - *Whole-database rollback:* use Neon's branch **Restore** on the primary
     branch to that timestamp. Neon keeps the pre-restore state as a backup
     branch, so the restore itself can be undone.
   - *Partial repair:* copy the affected rows from the restored branch into
     production with SQL, keeping everything written since.
5. **Verify** with the health check (`/api/health`), a sign-in, and the
   records that were damaged. Re-enable whatever you paused in step 1.
6. **Write it up.** Record the timeline, the data lost (if any), and what
   would have caught it sooner.

### Restore drill

Run this every quarter, and after any change to the Neon plan or the
retention setting:

1. Restore a branch from 24 hours ago, using step 3 of the runbook.
2. Point a local checkout at it, run `npm run db:drift`, and sign in to
   confirm it works.
3. Time the whole drill against the RTO and note any gaps.
4. Delete the drill branch.
