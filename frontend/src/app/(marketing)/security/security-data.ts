export interface ControlGroup {
  id: string;
  title: string;
  summary: string;
  points: string[];
}

export type ProgramStatus = "in-place" | "in-progress" | "planned";

export interface ProgramItem {
  title: string;
  status: ProgramStatus;
  body: string;
}

// Every claim here describes code in this repository; when a control changes,
// change its line here in the same pull request.
export const CONTROL_GROUPS: ControlGroup[] = [
  {
    id: "isolation",
    title: "Tenant isolation",
    summary: "Every company's data is fenced off three times over.",
    points: [
      "Every query is scoped to the workspace you have open, resolved from the database on each request, never from what the browser sends.",
      "A Prisma extension refuses any query that names another company, and Postgres row-level security enforces the same boundary inside every write.",
      "Another company's records behave as if they don't exist: a guessed id returns not found, never a permission error that confirms it's there.",
      "Hiring managers and interviewers reach only the jobs they're assigned to, directly or through a department.",
    ],
  },
  {
    id: "identity",
    title: "Identity and access",
    summary: "Strong sign-in, enforced by policy, re-checked on every request.",
    points: [
      "SAML and OIDC single sign-on per workspace, with enforcement, verified-domain sign-in and SCIM 2.0 provisioning and deprovisioning.",
      "Two-factor authentication with authenticator apps, passkeys and security keys, plus single-use recovery codes. Owners can require it for everyone.",
      "Sensitive changes ask you to confirm it's you if you signed in more than 10 minutes ago: API keys, SSO, security policies, role changes and exports.",
      "Owners set the minimum password length and can refuse passwords found in known breaches, checked by k-anonymity so the password never leaves the server.",
      "Active sessions are listed per device and can be ended individually or by an admin, with a configurable lifetime and idle timeout.",
      "IP allowlists restrict a workspace and its API keys to your office or VPN ranges.",
    ],
  },
  {
    id: "audit",
    title: "Audit and monitoring",
    summary: "A record of who did what that the database itself refuses to rewrite.",
    points: [
      "Every change is written to the audit log in the same transaction as the change, so neither can land without the other.",
      "Entries are sealed into a SHA-256 hash chain per company, and a database trigger refuses edits and deletes for every role. Admins can verify the chain at any time.",
      "Sign-ins, failed sign-ins, two-factor checks and exports are recorded alongside product activity.",
      "Admins can export the log as CSV or JSON Lines, and owners can stream it to Splunk, Datadog or a signed webhook.",
    ],
  },
  {
    id: "appsec",
    title: "Application security",
    summary: "Defaults that hold up to a penetration test.",
    points: [
      "A per-request nonce Content Security Policy with no inline script, framing denied, and HSTS with preload.",
      "Every form is validated by the same schema in the browser and again on the server.",
      "Sign-in, password reset, confirmation and API traffic are rate limited per account and per IP.",
      "Outbound calls to customer URLs (webhooks, SIEM) accept HTTPS only and refuse private, loopback and cloud metadata addresses, both when saved and at connect time.",
      "Uploaded resumes are identified by their bytes rather than their name, stored under a server-made key, parsed in the background and only ever served as downloads.",
    ],
  },
  {
    id: "data",
    title: "Data protection",
    summary: "Encrypted in transit and at rest, with secrets sealed separately.",
    points: [
      "All traffic is served over TLS, and the hosted service runs on providers that encrypt data at rest.",
      "SSO connection secrets, authenticator-app secrets, queued emails, webhook signing secrets and SIEM tokens are additionally sealed with AES-256-GCM, bound to the company they belong to.",
      "Passwords are hashed with bcrypt (cost 12). API keys are stored only as SHA-256 hashes and shown once.",
      "Outbound webhooks are signed with HMAC-SHA256 so you can confirm they came from us.",
    ],
  },
  {
    id: "ai",
    title: "AI and candidate data",
    summary: "The model only reads, it never decides, and every verdict shows its evidence.",
    points: [
      "Resume and job text is sent to the model only to score that application. ResumeRank doesn't train models on your data.",
      "Untrusted text is fenced off from the instructions, and attempts to steer the model are flagged to the recruiter rather than obeyed.",
      "Every verdict must quote the resume. A quote that isn't found in the resume is discarded, and a strong verdict without verified evidence is downgraded.",
      "Each scoring run is locked by the database once finished and keeps exactly what the model was given, so any score can be explained later.",
      "Workspaces can hide names, contact details and protected attributes from the model, require the AI notice first, and candidates can opt out of AI scoring entirely.",
      "Every stage change records what the AI had shown the person who made it, and admins can run impact-ratio reports from voluntary self-identification.",
    ],
  },
  {
    id: "operations",
    title: "Infrastructure and resilience",
    summary: "Managed infrastructure, tested recovery, gated releases.",
    points: [
      "Point-in-time database recovery targets at most 5 minutes of data loss and an hour to recover, rehearsed in a quarterly restore drill.",
      "Schema changes ship expand-then-contract, are applied to staging before production, and are proven against a copy of production-shaped data on every pull request.",
      "Every pull request runs type checks, unit and tenant-isolation integration tests, end-to-end tests, CodeQL, secret scanning over the full history, and a dependency advisory gate.",
      "Structured logs and OpenTelemetry traces on every request and AI call, with nothing secret in either.",
    ],
  },
];

export const PROGRAM: ProgramItem[] = [
  {
    title: "Security controls",
    status: "in-place",
    body: "Everything listed above is live and covered by automated tests.",
  },
  {
    title: "SOC 2 Type I",
    status: "in-progress",
    body: "Our controls are mapped to the Trust Services Criteria. We have not been audited yet, and we will say so until we have a report to share.",
  },
  {
    title: "Independent penetration test",
    status: "planned",
    body: "Scope and test plan are written. The report summary will be available on request once the test is complete.",
  },
  {
    title: "Data processing agreement",
    status: "in-progress",
    body: "Our DPA template, with the sub-processor annex and AI-specific terms, is published in the repository. Ask us to sign one.",
  },
];

export const STATUS_LABELS: Record<ProgramStatus, string> = {
  "in-place": "In place",
  "in-progress": "In progress",
  planned: "Planned",
};
