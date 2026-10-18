# Penetration test plan

The brief for an external penetration test: what to test, what we most want
challenged, how to set up the environment, and the rules. Send it to the
testing firm with the statement of work. Run the test once a year, and again
after any major change to authentication, tenancy or the public API.

## Objectives

1. Find ways to break the promises the product makes. The highest-priority
   areas below are those promises, not a generic checklist.
2. Cover the OWASP ASVS 4.0 Level 2 requirements for the web app and
   OWASP API Security Top 10 for `/api/v1`.
3. Produce a report suitable to share with customers under NDA, plus a
   summary letter for the `/security` page and SOC 2 evidence (CC4.1, CC7.1).

## Target

| Item | Value |
| --- | --- |
| Environment | **Staging**, a production build on its own Neon branch, never production |
| Web app | The staging URL: marketing, `(auth)` and `(app)` routes |
| API | `/api/v1/*` with keys of every scope, the SCIM endpoint `/api/scim/v2.0/*`, and SSO at `/api/oauth/*` |
| Webhook receivers | `/api/webhooks/stripe`, `/api/webhooks/resend` |
| Source code | This repository, white-box. Testers should read `AGENTS.md` and `docs/architecture.md` first |
| Out of scope | Production; Vercel, Neon, Groq, Stripe, Resend and Google themselves; volumetric DoS; social engineering; physical access |

## Areas we most want challenged

Each area lists the claim to break and where it is implemented.

**Tenant isolation.** One company can never read, change or confirm the
existence of another's data.
- `companyId` scoping in every service, the `tenantDb` extension, and RLS in
  `tenantTransaction` (`backend/src/tenant-db.ts`).
- Try ids from the other tenant everywhere one is accepted: pages, server
  actions, exports, the API, resume file downloads, webhook and SCIM payloads.

**Authorization within a tenant.**
- Viewers can't write.
- Hiring managers and interviewers reach only the jobs they're assigned to,
  directly or through a department (`services/access.ts`).
- Admins can't do owner-only things.
- Server actions are reachable without the UI, so call them directly with
  forged arguments.

**Authentication and sessions.**
- Two-factor can't be skipped. A session waiting at `/mfa` reaches nothing
  else.
- Step-up can't be skipped: sensitive actions within 10 minutes of sign-in
  only.
- Revoked sessions die on their next request, even though sessions are JWTs.
- A short password is held at `/password-change`.
- Password reset, verification and invite tokens are single-use and
  expiring.

**SSO and SCIM.**
- One company's identity provider can't sign anyone into another company.
  Account ids are tenant-qualified, and an IdP may only vouch for its
  company's verified domains (`sso/login.ts`).
- SAML assertions are validated: signature wrapping, replay, audience.
- SCIM requests can't touch another directory's users.

**IP allowlists.** A workspace's allowlist can't be bypassed: spoofed
`X-Forwarded-For`, IPv6 forms, API keys, workspace switching
(`auth/ip-allowlist.ts`, `request-ip.ts`).

**Audit log integrity.** Entries can't be changed or removed without
`verifyAuditLog` reporting the break, and a tenant can't purge outside
retention.

**Server-side request forgery.** Webhook and SIEM URLs can't reach private,
loopback, link-local or metadata addresses. Try DNS rebinding, redirects,
IPv6-mapped IPv4 and decimal or octal IPs (`audit/outbound.ts`).

**Resume uploads.**
- Type confusion and polyglots, oversized and zip-bomb Word files, and
  malicious PDFs against the parser.
- Downloads must stay attachments and never render inline.
- Blob keys must not be guessable across tenants.

**AI scoring.**
- Prompt injection from resume text or recruiter-entered job fields. A
  successful steer must be flagged to the recruiter, and quotes must exist
  in the resume.
- Exfiltrating one candidate's data into another's score.
- Running up another company's AI budget.

**Public API.**
- Key scopes are enforced.
- Revoked or expired keys are refused.
- Rate limits hold.
- Responses come from serializers and never leak extra fields.

**Billing.** Plan, seats and status change only through verified Stripe
webhooks. A tenant can't grant itself an entitlement or a seat.

**Browser.**
- The CSP blocks script injection anywhere, the SAML POST page included.
- CSRF on server actions and route handlers.
- Spreadsheet formula injection in CSV exports.

## Environment setup

Before the test, the team prepares:

- [ ] Staging deployed from the commit under test, with production
      configuration: SSO, MFA and billing keys set (Stripe test mode).
- [ ] Two companies, **Alpha** and **Bravo**. Each has an account for every
      role (owner, admin, member, hiring manager, interviewer, viewer), and
      one person belongs to both.
- [ ] In Alpha: a department, jobs assigned to the hiring manager and the
      interviewer, others not assigned, and candidates with uploaded resumes
      and finished scoring runs.
- [ ] Bravo has SSO enforced against a test IdP the testers control, with a
      verified domain and SCIM directory sync.
- [ ] One account with a TOTP factor, one with a passkey, and one with
      neither.
- [ ] API keys of each scope in both companies, and a webhook endpoint
      pointed at a receiver the testers control.
- [ ] An IP allowlist on one workspace.
- [ ] The testers' source IPs, the test window and an emergency contact,
      exchanged in writing.
- [ ] Rate limits left on. Ask before raising any, and record any change.

## Rules of engagement

- Staging only. If a finding seems to apply to production, report it. Don't
  try it there.
- No volumetric denial of service. Rate-limit testing is fine at the volume
  needed to show the limit.
- Use the test accounts only. Don't create accounts with real people's email
  addresses.
- Stop and call the emergency contact at once if you find live customer data,
  a leaked credential, or a SEV-1 class issue
  ([`incident-response.md`](incident-response.md)).
- Keep finding details encrypted in transit and at rest, and delete test data
  copies when the report is accepted.

## Deliverables and follow-up

- A report with each finding's CVSS 4.0 score, reproduction steps, affected
  code where known, and a suggested fix. Also an executive summary, and a
  letter stating the dates and scope.
- Findings go into private GitHub security advisories and follow the fix
  targets in [`SECURITY.md`](../../SECURITY.md).
- Every fixed finding gets a regression test: an integration probe for
  tenancy and authorization, and an e2e spec for browser issues.
- The firm retests the fixes within 60 days.
- Afterwards, update the `/security` page status (`PROGRAM` in
  `frontend/src/app/(marketing)/security/security-data.ts`) and the CC7.1 row
  in [`soc2-readiness.md`](soc2-readiness.md).
