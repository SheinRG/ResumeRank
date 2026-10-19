# SOC 2 readiness

**Status: not audited.** This page maps ResumeRank's controls to the AICPA
Trust Services Criteria (2017, revised points of focus 2022). It shows where
the evidence for each control lives and what is still missing before an
auditor can test it. Nothing here is an attestation. The public `/security`
page says "SOC 2: in progress" and must keep saying that until a report
exists.

Proposed scope for the first report: **Security** (the common criteria,
required), **Availability** and **Confidentiality**. Processing Integrity and
Privacy wait until the Phase 3 compliance work (decision log, retention,
data-subject requests) has shipped. The system in scope is the hosted
service: the Next.js app on Vercel, the Neon Postgres database, Vercel Blob
for resume files, and the GitHub repository and Actions that build them.

## Path to a report

1. **Choose a compliance platform (Vanta or Drata).** Both continuously
   collect evidence from connected systems, ship policy templates, run access
   reviews and introduce auditors. Choose on three things:
   - which of GitHub, Vercel, Neon, Google Workspace and the endpoint
     management tool each one connects to natively (anything not covered
     becomes a manual screenshot every quarter);
   - the price at our headcount;
   - which audit firms each one partners with.
2. **Close the organisational gaps** below. Most of them are policy and
   process, not code.
3. **Type I.** An auditor tests that the controls are designed properly at a
   single point in time. This is usually possible within a few weeks of the
   gaps closing.
4. **Type II.** The same controls are tested as operating over an observation
   window of at least 3 months. Enterprise buyers usually ask for this one.
5. **Penetration test** before the Type I. Auditors expect a recent one under
   CC4.1 and CC7.1. Scope and rules are in [`pen-test.md`](pen-test.md).

## Control matrix

Each row lists the control as built and the evidence an auditor would sample.
"Gap" means a control is needed and missing. "Verify" means the setting
exists outside the repository and has to be checked and captured as evidence.

### CC6: Logical and physical access

| Criterion | Control in ResumeRank | Evidence | Gap / verify |
| --- | --- | --- | --- |
| CC6.1 Access is restricted to authorized users | Every request re-reads the user, membership and session from the database (`frontend/src/lib/auth/guards.ts`); permissions per role (`backend/src/auth/roles.ts`); per-job access for hiring managers and interviewers (`services/access.ts`) | Guard code; `tests/integration/rbac.test.ts`; e2e `rbac.spec.ts` | None |
| CC6.1 Tenant data is segregated | Explicit `companyId` scoping, the `tenantDb` Prisma extension, and Postgres RLS under `tenantTransaction` (`backend/src/tenant-db.ts`) | `tenant-isolation.test.ts`, `rls.test.ts`, `tenant-db.test.ts`; e2e `tenant-isolation.spec.ts` | None |
| CC6.1 Strong authentication | Bcrypt (cost 12) passwords; per-workspace password policy with a breached-password check; TOTP, passkeys and recovery codes, with an MFA-required policy; SAML/OIDC SSO with enforcement | `docs/architecture.md` (Two-factor authentication, Password policy); `mfa.test.ts`, `password-policy.test.ts`, `sso.test.ts` | **Verify:** MFA enforced on GitHub, Vercel, Neon, Groq, Stripe and Google Workspace admin accounts |
| CC6.1 Encryption keys are protected | Secrets come only from `env()`; sealed values use AES-256-GCM with subkeys bound to company and purpose (`backend/src/sealed-box.ts`) | Code; `.env.example` key guidance | **Gap:** a written key-rotation procedure (AUTH_SECRET, SSO, MFA and Stripe keys), with a record of each rotation |
| CC6.1 Staff access to customer workspaces is limited and logged | Staff are granted only by `npm run staff` and need their own proven second factor; staff see workspace metadata, not candidates; viewing a workspace's data needs the customer's support-access grant, lasts at most an hour, and is read-only in the database; every staff search, view and change is in the append-only staff audit log and changes are in the customer's own log (`backend/src/staff/*`) | `staff.test.ts`; `StaffAuditEntry`; Settings → Security support sessions | **Gap:** a periodic review of who holds staff access, recorded with `npm run staff -- list` |
| CC6.2 Users are provisioned and deprovisioned | Invites with expiring tokens (`services/team.ts`); SCIM deprovisioning (`sso/directory.ts`); removing a member revokes their sessions in the same transaction | `scim.test.ts`, `memberships.test.ts`; audit log `team.*` entries | **Gap:** a staff onboarding and offboarding checklist for the production consoles |
| CC6.3 Role changes are authorized | Role changes need an admin plus step-up re-authentication, and are audited; ownership transfer is its own flow | `step-up.test.ts`, `ownership.test.ts`; audit entries | **Gap:** quarterly access review of who holds owner and admin roles in the production consoles (the platform runs this) |
| CC6.6 External threats are blocked at the boundary | Nonce CSP, HSTS with preload, `frame-ancestors 'none'`; shared Postgres rate limits; per-workspace IP allowlists; outbound requests limited to HTTPS with private and metadata addresses refused (`audit/outbound.ts`) | `docs/architecture.md` (Security headers and CSP, Rate limiting, IP allowlisting); `rate-limit.test.ts`, `ip-allowlist.test.ts` | **Verify:** Vercel firewall and DDoS settings |
| CC6.7 Data in transit is protected | TLS everywhere (HSTS); webhooks signed with HMAC-SHA256; SIEM tokens bound to their URL | `next.config.ts`; `webhooks/outbox.ts` | None |
| CC6.8 Malicious software is prevented | Uploaded file types are sniffed from the bytes, stored under server-made keys, parsed off-request and served only as attachments; dependency advisory gate; Dependabot | `resume-files.test.ts`; `.github/workflows/ci.yml`; `.github/audit-allowlist.json` | **Gap:** endpoint protection (MDM, disk encryption, screen lock) on staff laptops, evidenced by the platform agent |

### CC7: System operations

| Criterion | Control in ResumeRank | Evidence | Gap / verify |
| --- | --- | --- | --- |
| CC7.1 Vulnerabilities are found | CodeQL (`security-extended`) and gitleaks over the full git history, weekly and on every PR; `npm run audit:gate`; Dependabot | `.github/workflows/security.yml`; run history | **Gap:** an annual external penetration test ([`pen-test.md`](pen-test.md)) |
| CC7.1 Configuration drift is detected | `npm run db:drift` fails CI when the schema and migrations disagree; flag overrides are audited | `ci.yml`; `npm run flags` audit entries | None |
| CC7.2 Anomalies are monitored | Structured JSON logs (`observability/log.ts`); OpenTelemetry traces; auth events (`auth.sign_in_failed`, `auth.mfa_failed` and others) in a tamper-evident audit log; SIEM streaming per company | `docs/architecture.md` (Observability, Audit log); `audit.test.ts` | **Gap:** alerting. Error-rate, failed sign-in spike and scoring-queue backlog alerts routed to a person, plus a log drain retained for at least a year |
| CC7.3–CC7.5 Incidents are handled | Incident response procedure with severities, roles, runbooks and customer notification | [`incident-response.md`](incident-response.md) | **Gap:** a tabletop exercise each year, with the record kept |

### CC8: Change management

| Criterion | Control in ResumeRank | Evidence | Gap / verify |
| --- | --- | --- | --- |
| CC8.1 Changes are authorized, tested and approved | Every change goes through a PR. CI runs lint, typecheck, unit, integration and e2e tests, the build and the bundle budget. Scoring changes are gated by the eval harness. Migrations hit staging before production. Deploys follow migrations | `.github/workflows/ci.yml`, `deploy.yml`, `scoring-eval.yml`; `docs/operations.md`; PR history | **Verify:** branch protection on `main` (required checks, no force-push, required review). **Gap:** segregation of duties. With one engineer, a second reviewer or a documented compensating control (the platform's change-approval check, plus production deploys needing the `production` environment approval) |
| CC8.1 Schema changes are safe | Expand-then-contract policy; per-PR Neon branch proving migrations against production-shaped data | `docs/operations.md`; `preview-db.yml` | None |

### CC9: Risk mitigation

| Criterion | Control in ResumeRank | Evidence | Gap / verify |
| --- | --- | --- | --- |
| CC9.1 Business disruption is planned for | Backups and recovery objectives (see A1) | `docs/operations.md` | **Gap:** a business continuity plan covering loss of a provider or of the sole engineer |
| CC9.2 Vendors are managed | Sub-processors are listed on `/security`, generated from the deployment's configuration (`backend/src/sub-processors.ts`) | `sub-processors.test.ts` | **Gap:** a vendor register with each vendor's SOC 2 report or equivalent, reviewed every year; DPAs with every sub-processor (Groq especially, since it receives resume text) |

### CC1–CC5: Control environment, communication, risk assessment, monitoring

These criteria cover the organisation more than the code.

| Criterion | Gap |
| --- | --- |
| CC1.1–CC1.5 Integrity, oversight, structure, competence, accountability | **Gap:** code of conduct; org chart; security responsibilities named in job descriptions; background checks for staff with production access |
| CC2.1–CC2.3 Information and communication | **Gap:** security awareness training at hire and every year after. External communication is in place: `/security`, `SECURITY.md` and `security.txt` |
| CC3.1–CC3.4 Risk assessment | **Gap:** an annual risk assessment with a risk register (fraud risk included), refreshed when the system changes significantly |
| CC4.1–CC4.2 Monitoring of controls | **Gap:** continuous control monitoring (the platform provides it) and a process for tracking control failures to closure |
| CC5.1–CC5.3 Control activities and policies | **Gap:** the policy set below, approved and acknowledged by staff |

### Availability (A1)

| Criterion | Control | Evidence | Gap / verify |
| --- | --- | --- | --- |
| A1.1 Capacity is managed | Per-company AI budgets; queued scoring with backoff; rate limits; connection-pool sizing | `docs/architecture.md` (Scoring pipeline, Rate limiting); `backend/src/ai-budget.ts` | **Gap:** load-test baseline (roadmap: k6) |
| A1.2 Backups and recovery | Neon point-in-time recovery with RPO ≤ 5 minutes and RTO ≤ 1 hour; restore runbook | `docs/operations.md` (Backups and disaster recovery) | **Verify:** Neon history retention matches the RPO. **Gap:** a logical backup outside Neon |
| A1.3 Recovery is tested | Quarterly restore drill | `docs/operations.md` (Restore drill) | **Gap:** keep a dated record of each drill and its measured time |

### Confidentiality (C1)

| Criterion | Control | Evidence | Gap / verify |
| --- | --- | --- | --- |
| C1.1 Confidential information is identified and protected | Resume text, candidate contact details and AI outputs are tenant-scoped and reachable only by role and job assignment; secrets sealed at rest | Tenancy and RBAC evidence above | **Gap:** a data classification policy naming these categories |
| C1.2 Confidential information is disposed of | Candidate erasure removes every record and file; per-company candidate retention with a scheduled purge; workspace export and deletion; audit-log retention purge | `docs/architecture.md` (Data lifecycle, Audit log); `data-lifecycle.test.ts` | None |

## Policies to adopt

Start each one from the platform's templates. Adapt it to what the code
already does, approve it, and have staff acknowledge it.

- Information security policy (the umbrella, owned by a named person)
- Access control: least privilege, MFA on every production console, quarterly
  reviews, offboarding within one business day
- Change management: matches CC8.1 above, including the solo-engineer
  compensating control
- Incident response: [`incident-response.md`](incident-response.md)
- Business continuity and disaster recovery: `docs/operations.md` plus the
  provider-loss plan
- Vulnerability management: severity targets from [`SECURITY.md`](../../SECURITY.md)
  and the dependency audit gate's review dates
- Vendor management
- Data classification, retention and disposal
- Encryption and key management
- Secure development: [`AGENTS.md`](../../AGENTS.md) already reads as one
- Acceptable use, and security awareness training
- Risk assessment

## Keeping this page true

When a control changes, update its row in the same PR, as well as the matching
line on `/security` (`frontend/src/app/(marketing)/security/security-data.ts`).
When a gap closes, replace it with the evidence that closed it.
