# Security policy

ResumeRank holds hiring data: resumes, scores and the decisions made on them.
If you find a way to reach data you shouldn't, we want to hear about it before
anyone else does.

## Reporting a vulnerability

Report it privately through
[GitHub's security advisory form](https://github.com/SheinRG/ResumeRank/security/advisories/new).
Please don't open a public issue, pull request or discussion for a
vulnerability.

A useful report includes:

- what an attacker can do, and as whom (signed out, viewer, member, admin, or
  another company's user);
- the steps or a proof of concept, with the requests involved;
- the version or commit you tested, and whether it was the hosted service or a
  self-hosted install.

## What happens next

| Step | Target |
| --- | --- |
| Acknowledgement | 3 business days |
| Triage and severity (CVSS 4.0) | 7 days |
| Fix released, critical | 7 days after triage |
| Fix released, high | 30 days after triage |
| Fix released, medium or low | 90 days after triage |

We keep you updated in the advisory thread, credit you in the published
advisory if you'd like, and agree a disclosure date with you. If a fix needs
longer than the target, we say why and when.

## Scope

**In scope:**

- the hosted application and its public API (`/api/v1`);
- the code in this repository, including issues that only affect self-hosted
  installs.

The findings we care most about are the ones the product promises against.
They are listed in [`docs/security/pen-test.md`](docs/security/pen-test.md).
Examples:

- reaching another company's data;
- acting beyond your role or job assignment;
- bypassing SSO, two-factor, step-up, IP allowlist or session revocation;
- editing the audit log without the chain showing it;
- server-side request forgery through webhooks or SIEM streams;
- steering the scoring model in a way the recruiter isn't warned about.

**Out of scope:**

- volumetric denial of service, and load testing against the hosted service;
- social engineering, phishing and physical attacks;
- the infrastructure of our providers (Vercel, Neon, Groq, Stripe and the
  rest), which have their own programs;
- reports from automated scanners without a demonstrated impact;
- missing headers or best practices that don't lead to an exploit;
- clickjacking on pages without a state-changing action;
- self-XSS, and attacks that need a compromised device or browser.

## Safe harbor

Research done in good faith under this policy is authorized. We won't pursue
or support legal action against you for it. Good faith means:

- you test only against accounts and workspaces you own or have permission to
  use;
- you stop and report as soon as you reach anyone else's data, and you don't
  keep, share or change it;
- you don't degrade the service for other people;
- you give us reasonable time to fix the issue before you disclose it.

## Supported versions

Only the latest release on `main` gets security fixes. If you self-host, keep
your deployment up to date with it.

## More

- Controls and sub-processors: the `/security` page of the running app.
- Machine-readable contact: `/.well-known/security.txt` (RFC 9116).
- SOC 2 readiness: [`docs/security/soc2-readiness.md`](docs/security/soc2-readiness.md).
- Incident response: [`docs/security/incident-response.md`](docs/security/incident-response.md).
