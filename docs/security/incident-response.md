# Incident response

What to do when something goes wrong with security or data: a vulnerability
report that turns out to be real, a leaked secret, a compromised account,
data reaching the wrong company, or data being lost. A plain outage follows
the same steps at SEV-3 unless data is involved. Recovering lost or corrupted
data has its own runbook in [`operations.md`](../operations.md#restore-runbook).

## Severity

| Level | Meaning | Examples | First response |
| --- | --- | --- | --- |
| **SEV-1** | Customer data exposed or changed by someone not entitled to it, or a working exploit for that | Cross-tenant read; leaked `AUTH_SECRET` or database credentials; auth bypass | Immediately, around the clock |
| **SEV-2** | A serious weakness with no sign of use, or one account compromised | Valid vulnerability report (high); one customer's admin account taken over | Same business day |
| **SEV-3** | Limited impact or degraded service | Medium or low report; scoring or email queue stalled; an outage with no data impact | Next business day |

When unsure, pick the higher level. Lowering it later costs nothing.

## Roles

One person can hold more than one role, and on a small team usually does.
Write down who holds which at the start.

- **Incident lead:** owns decisions and the timeline, and declares the end.
- **Investigator:** works the logs, the audit trail and the code.
- **Communicator:** writes to affected customers and the reporter.

## The steps

1. **Open a record.** Use a private GitHub security advisory for
   vulnerabilities, or a private doc otherwise. From now on, every action
   goes in it with a UTC timestamp.
2. **Contain.** Stop further harm before understanding it fully. Use the
   containment tools below.
3. **Preserve evidence.**
   - Export the affected companies' audit logs (`/activity/export`, or by SQL
     as the table owner) and run the chain check under Settings → Audit.
   - Save the relevant Vercel and OpenTelemetry logs before they age out. The
     `action` log lines name the actor, company and outcome of every mutation.
   - Don't delete or rewrite anything that might be evidence.
4. **Scope.** Answer three questions: which companies, which records, and
   between which times. The audit log, `LoginSession` rows (IP, device,
   method) and request logs answer most of it.
5. **Eradicate.** Fix the cause and deploy through the normal pipeline. For a
   SEV-1, a deploy can skip waiting for review, but never the CI checks. Add a
   test that fails without the fix: a tenant-isolation probe in
   `backend/tests/integration` for anything that crossed tenants.
6. **Recover.** Restore data if needed ([restore runbook](../operations.md#restore-runbook)),
   re-enable anything you turned off, and watch for recurrence.
7. **Notify.** See the notification section below.
8. **Review within 5 business days.** Cover the timeline, the cause, why it
   wasn't caught sooner, and the follow-up actions with owners. If a control
   changed, update [`soc2-readiness.md`](soc2-readiness.md) and `/security`.

## Containment tools

| Situation | Tool | Effect |
| --- | --- | --- |
| A member's account is compromised | Settings → Team → sign out (admin), then remove or reset MFA | All their sessions end on the next request; an MFA reset also signs them out |
| Your own account is compromised | Settings → Security → sign out other sessions, change password | Other sessions end; the password change revokes the rest |
| An API key leaked | Settings → API → revoke | Refused on the next request |
| A webhook signing secret leaked | Delete and recreate the endpoint | The new endpoint gets a new secret |
| A customer needs network lock-down | Settings → Security → IP allowlist (owner) | Members outside the ranges are refused, and so are API keys |
| A feature is being abused | `npm run flags -- set <company> <flag> off --reason "..."` | Turned off for that company, and recorded in its audit log |
| A deploy introduced the problem | Vercel → instant rollback to the previous deployment | The schema stays put (expand/contract keeps it compatible) |
| Scoring is behaving badly | Unset `GROQ_API_KEY` in the environment and redeploy | Scoring requests fail cleanly; nothing else depends on it |

### Rotating a leaked secret

Rotate it in the host's environment settings and redeploy. Know what each one
takes down with it:

| Secret | Rotating it also… |
| --- | --- |
| `AUTH_SECRET` | Signs everyone out. Also: makes queued emails undeliverable (send them again); stops SIEM streams until each is saved again; voids outbound webhook signing secrets (recreate the endpoints); voids authenticator-app secrets if `MFA_ENCRYPTION_KEY` is unset (those users enrol again; passkeys and recovery codes keep working) |
| `MFA_ENCRYPTION_KEY` | Every authenticator app must be set up again |
| `SSO_ENCRYPTION_KEY` | Every company must reconnect its identity provider |
| `DATABASE_URL` / `DIRECT_URL` password | Nothing beyond the redeploy. Rotate it in Neon first |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Roll the key in Stripe, then update both |
| `GROQ_API_KEY`, `RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET` | Nothing beyond the redeploy |

A secret that was committed to git also needs the gitleaks finding resolved.
Treat it as leaked even after the history is rewritten.

## Notification

- **Affected customers:** tell the owners of every affected company **without
  undue delay, and within 72 hours** of confirming that their data was
  exposed. Customers are the data controllers under GDPR and have their own
  72-hour deadline to their regulator, so they need enough detail to meet it:
  what happened, which data, the time window, what we've done, and what they
  should do.
- **Reporters:** update them in the advisory thread at each step, and agree a
  disclosure date. Targets are in [`SECURITY.md`](../../SECURITY.md).
- **Public:** publish the GitHub security advisory once a fix is deployed,
  for anything that affects self-hosted installs too.
- **Sub-processors:** if the incident started at a provider, follow their
  process and pass their findings on to customers.

Don't name other customers, and don't guess about the cause in customer
messages. Say what is known and when the next update will come.

## Practice

Run a tabletop exercise every year, and after any major change to
authentication or tenancy. Walk a SEV-1 scenario (for example, a leaked
`AUTH_SECRET`) through these steps, time it, and keep the record as SOC 2
evidence (CC7.4).
