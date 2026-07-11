# Case study

## Problem

A recruiter looking at fifty applications for one role has two bad options:
read every resume closely (slow), or trust a keyword-matching ATS score
(fast, but unaccountable — a number with no way to check it). Neither lets
them defend a shortlisting decision to a hiring manager or a candidate who
asks why they were passed over. ResumeRank's bet is that the fix isn't a
better score, it's a score that shows its work: every requirement mapped to
a verdict, a quote from the resume as evidence, and a named gap when the
evidence isn't there.

## Approach

The brief specified a plan-then-build gate; the reviewer instructed a
one-shot build instead, so `docs/plan.md` was written first — pitch, user
stories, a full data model, and explicit assumptions — and implementation
followed immediately without waiting for a separate approval round. The
milestone sequence (`docs/plan.md`) was: schema/auth/RBAC, core CRUD and
pipeline, search/filter/sort/pagination, AI scoring, dashboard, then this
milestone — SEO, docs, and CI. Scoring was deliberately milestone 4, after
the pipeline existed, so there was always something real to score against
rather than building the LLM integration against fixtures.

## Key decisions and trade-offs

**`Evaluation.verdict` enum over a boolean match.** The brief's original
shape was closer to `matched: boolean`. A boolean can't express "the resume
shows two of the four required years" — it forces every partial match to
round to a false, which is exactly the kind of unaccountable judgment call
this product exists to avoid. `STRONG | PARTIAL | MISSING` costs one extra
enum and buys the half-credit scoring math in `src/lib/scoring/math.ts` and a
UI badge that reads honestly. Partial credit is where the explainability
promise actually earns its keep.

**Requirements as rows, not a JSON blob.** `JobRequirement` is a table, not a
`Json` column on `Job`. The alternative is fewer migrations and a
simpler create form. The cost of that shortcut shows up immediately at
scoring time: an `Evaluation` needs to foreign-key the *exact* requirement it
judged, and reordering or re-weighting requirements needs to be queryable,
not "parse the blob, mutate an array, write the whole thing back." Rows won.

**Pasted resume text over file upload.** PDF/DOCX parsing is a real failure
surface — encoding issues, scanned images with no text layer, layout
extraction that mangles bullet points — and none of it touches the thing
this project is actually about, which is what happens *after* you have
resume text. Pasting text keeps the 60-second core loop (create job → add
candidate → score) friction-free and pushes file parsing to the roadmap
instead of the critical path. `resumeText` is the scoring source of truth
either way, so adding upload later is additive, not a rewrite.

**JWT sessions over database sessions.** Auth.js supports both. JWT avoids a
session-table round trip on every request, which matters more once RBAC
guards are re-checking the user on every single mutation anyway (see
`docs/architecture.md`). The trade-off is that revoking a session instantly
(e.g. "force logout everywhere") isn't free with JWT the way it is with a
database session row you can delete — an accepted gap for a project this
size, not something a recruiter workflow needs on day one.

**In-process rate limiting over Redis.** `src/lib/rate-limit.ts` is a
`Map`-backed fixed-window bucket. It is *correct* on one serverless instance
per region and *wrong* the moment there are two — an attacker spread across
instances gets a fresh bucket on each. Reaching for Upstash Redis on day one
would have meant paying an external dependency and a network round trip on
every login attempt to solve a problem this project doesn't have yet at its
current scale. The limitation is named, not hidden, in both
`docs/plan.md` and `docs/architecture.md`, with the upgrade path spelled out.

## Result

All seven milestones in `docs/plan.md` are represented in the codebase: a
migrated schema with a seeded demo workspace, email/password and Google auth
with server-enforced roles, full CRUD across jobs/candidates/applications
with soft delete, server-side search/filter/sort/pagination with CSV export,
Groq-backed scoring with the reconciliation guarantees in
`src/lib/scoring/parse.ts`, a dashboard built on real aggregate queries, and
this milestone: a public landing page, OG image, sitemap/robots, JSON-LD,
security headers, and this documentation set.

## Learnings

- **Constraining the LLM's output shape does more than a good prompt.**
  `reconcileResult` in `src/lib/scoring/parse.ts` doesn't just validate JSON
  structure — it checks every `evidence` string against the actual resume
  text and silently nulls it out if the model paraphrased instead of quoted.
  A prompt instruction ("quote verbatim") is a request; a string-containment
  check is a guarantee.
- **Writing the data model as rows instead of blobs pays for itself at the
  second consumer, not the first.** The requirements-as-rows call felt like
  over-engineering while only the job-creation form existed. It stopped
  feeling that way the moment the scoring pipeline needed to join evaluations
  back to requirements by id.
- **Naming a limitation is different from ignoring it.** The rate limiter and
  the single-workspace model are both real constraints, not oversights —
  writing them into `docs/plan.md` as explicit assumptions up front made it
  possible to build fast without pretending the shortcuts weren't shortcuts.
