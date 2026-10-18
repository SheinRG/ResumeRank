# Data processing agreement (template)

**Status: template, not legal advice.** Have counsel review it before anyone
signs it. Square brackets mark what each agreement fills in. It follows the
structure of GDPR Article 28(3) and pairs with the EU Standard Contractual
Clauses (Module 2, controller to processor) where personal data leaves the
EEA.

## 1. Parties and roles

- **Customer** ([legal name, address]) is the **controller** of the
  personal data its workspace holds: its candidates and its own staff.
- **[Provider legal name]** ("ResumeRank") is the **processor**. It processes
  that data only to provide the service.

## 2. Subject matter, nature and purpose

ResumeRank provides an applicant-tracking and AI-assisted resume screening
service. Processing consists of storing, organising and displaying the data,
scoring applications against job requirements with an AI model, sending
transactional email, and the security, backup and support work the service
needs.

## 3. Data subjects and categories of data

| Data subjects | Categories |
| --- | --- |
| Candidates | Name, email address, resume text and files (which may include work history, education, contact details and anything else a candidate chooses to include), applications, stages, ratings, AI verdicts and scores, notice and opt-out records, and voluntary self-identification (sex, race/ethnicity) |
| Customer staff | Name, email address, role, sign-in and security records (IP address, device, timestamps), activity in the workspace |

**Special categories.** Self-identification answers are special-category
data (Art. 9). They are collected only with the candidate's explicit,
optional consent. They are stored separately from everything scoring reads,
and they are only ever reported in aggregate.

## 4. Duration

For the term of the subscription. Then either:

- deletion when the customer deletes its workspace (Settings → Company,
  which deletes immediately); or
- deletion within [30] days of termination.

The only exception is backups, which expire within the database provider's
point-in-time history window ([7] days).

## 5. Processor obligations

ResumeRank will:

1. process personal data only on the customer's documented instructions,
   which this agreement and the customer's use of the product constitute;
2. ensure everyone authorised to process it is bound by confidentiality;
3. implement the measures in Annex B;
4. engage sub-processors only as in Section 6;
5. help the customer respond to data-subject requests. The product provides
   a per-candidate data export (Art. 15 and 20), deletion with every related
   record (Art. 17), an AI opt-out (Art. 21 and 22), and correction by editing
   (Art. 16);
6. help with the customer's security, breach-notification, DPIA and
   prior-consultation obligations, including the documentation on the `/ai`
   model card and `/security` pages;
7. delete or return all personal data at the end of the service (Section 4);
   the workspace export (JSON Lines) is the return format;
8. make available the information needed to demonstrate compliance, and
   allow audits as in Section 8.

## 6. Sub-processors

The customer authorises the sub-processors in Annex A. ResumeRank will:

- give at least [30] days' notice of a new sub-processor, on the `/security`
  page and by email to workspace owners;
- impose data-protection terms on each sub-processor that are no less
  protective than this agreement;
- remain liable for each sub-processor's performance.

The customer may object on reasonable grounds within the notice period. If
the parties can't resolve the objection, the customer may terminate the
affected service.

## 7. Personal data breaches

ResumeRank will notify the customer **without undue delay, and within 72
hours** of becoming aware of a breach affecting its data. The notice will
contain the information Art. 33(3) requires, as far as it is known, and
ResumeRank will update it as more is learned. The procedure is in
`docs/security/incident-response.md`.

## 8. Audits

ResumeRank will answer reasonable security questionnaires and provide its
most recent independent audit report or penetration test summary, once one
exists (see `/security` for status). On-site audits need [30] days' notice,
happen at most once a year, and are at the customer's cost unless they find a
material breach.

## 9. International transfers

Where personal data is transferred outside the EEA, UK or Switzerland
without an adequacy decision, the EU Standard Contractual Clauses (Module 2,
and Module 3 for onward transfers to sub-processors) and the UK Addendum
apply. They are incorporated by reference.

## 10. AI-specific terms

- The AI model never makes a decision. It produces verdicts with quoted
  evidence for a person to review, and every stage change is recorded with
  the AI output shown at the time.
- Customer data is sent to the model provider only to score the application
  in question. It is not used to train ResumeRank's or the provider's models.
- The customer may turn on redaction of personal details before scoring, may
  require the AI notice before scoring, and must honour candidates' opt-outs,
  which the product enforces.
- ResumeRank provides the documentation a deployer needs under the EU AI Act
  (Art. 26) and for NYC Local Law 144 bias audits: the model card, the impact
  ratio report, and the scoring records with their inputs.

---

## Annex A: Sub-processors

The `/security` page of each deployment lists the sub-processors it is
actually configured with. For the hosted service:

| Sub-processor | Purpose | Data | Location |
| --- | --- | --- | --- |
| Vercel Inc. | Hosting, resume file storage | All application traffic; resume files | [region] |
| Neon Inc. | Managed Postgres | All workspace data | [region] |
| Groq Inc. | AI inference | Job requirements and the resume text being scored | United States |
| Resend Inc. | Transactional email | Recipient address and message | [region] |
| Stripe Inc. | Billing (paid plans) | Workspace name, billing contact, payment details | [region] |
| Google LLC | Sign in with Google (optional) | Name, email, profile picture | [region] |

## Annex B: Technical and organisational measures

The measures in place are described, with the code that implements them, on
the `/security` page and in `docs/security/soc2-readiness.md`. In summary:

- **Isolation:** per-company scoping on every query, a query-layer guard, and
  Postgres row-level security.
- **Access:** single sign-on with SCIM, two-factor authentication,
  per-workspace password and session policies, step-up re-authentication,
  IP allowlists, and role- and job-based access.
- **Audit:** a tamper-evident, append-only audit log with export and SIEM
  streaming, and immutable scoring records.
- **Encryption:** TLS in transit, provider encryption at rest, and AES-256-GCM
  sealing of credentials and secrets.
- **Resilience:** point-in-time recovery (RPO ≤ 5 minutes, RTO ≤ 1 hour) and
  quarterly restore drills.
- **Lifecycle:** configurable candidate retention with automatic deletion,
  per-candidate export and erasure, and workspace export and deletion.
- **Development:** code review, automated tests including tenant-isolation
  tests, CodeQL, secret scanning and dependency advisories.
