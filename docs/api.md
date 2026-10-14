# ResumeRank REST API

Version 1, served under `/api/v1`. It is for server-to-server integrations
(an HRIS, a job board, an internal dashboard). Browsers can't call it
directly: there is no CORS, and a key must never ship to a browser.

## Authentication

An admin creates a key in **Settings → API**. The key is shown once. Send it
on every request:

```
Authorization: Bearer rr_k1a2b3…_s3cr3t…
```

A key acts as the admin who created it:

- It can never do more than that person's **current** role allows. Demote
  them and their keys narrow at once. When they leave the workspace, their
  keys are deleted.
- Its **permissions** (scopes) narrow it further:

| Scope | Allows |
|---|---|
| `jobs:read` | `GET /jobs`, `GET /jobs/{id}` |
| `candidates:read` | `GET /candidates`, `GET /candidates/{id}` |
| `candidates:write` | `POST /candidates` |
| `applications:read` | `GET /jobs/{id}/applications`, `GET /applications/{id}` |
| `applications:write` | `POST /applications`, `PATCH /applications/{id}` |
| `scoring:write` | `POST /applications/{id}/score` |

Keys can expire after 30, 90 or 365 days, or never. Revoking a key takes
effect on the next request. Actions taken through a key are recorded in the
activity log under the creator's name.

## Conventions

- JSON in and out. Timestamps are ISO 8601 in UTC.
- **Pagination.** Lists return `{ data, nextCursor, total, totalCapped }` with
  25 items a page. Pass `nextCursor` back as `?after=` for the next page; it
  is null on the last one. `total` is exact up to a cap, and `totalCapped` is
  set past it.
- **Rate limit.** 600 requests a minute per key. Past that you get a `429`
  with `Retry-After` (seconds).
- **Errors** look like this:

  ```json
  { "error": { "code": "not_found", "message": "This job no longer exists.", "details": {} } }
  ```

  | Status | `code` | When |
  |---|---|---|
  | 400 | `invalid_request` | Malformed JSON, or fields that fail validation (`details` maps each field to its messages) |
  | 401 | `unauthorized` | Missing, unknown, revoked or expired key |
  | 403 | `insufficient_scope` / `forbidden` | The key lacks the scope, or the creator's role can't do this |
  | 404 | `not_found` | No such record **in this workspace**, or one the creator can't reach. Ids from other workspaces look exactly like missing ones |
  | 409 | `conflict` | E.g. the candidate is already on that job, or the email is taken |
  | 422 | `unprocessable` | A valid request the current state refuses, e.g. adding to an archived job |
  | 429 | `rate_limited` | Slow down; see `Retry-After` |
  | 500 | `internal_error` | Our fault; the message carries a reference to quote |

## Endpoints

### Jobs

`GET /api/v1/jobs?q=&status=DRAFT|OPEN|CLOSED|ARCHIVED&sort=newest|oldest|title&after=`

`GET /api/v1/jobs/{id}` returns the description and the requirements used as
the scoring rubric (`id`, `label`, `weight`: `MUST` or `NICE`).

### Candidates

`GET /api/v1/candidates?q=&source=&sort=newest|oldest|name&after=`

`GET /api/v1/candidates/{id}` includes `resumeText` and the candidate's
applications.

`POST /api/v1/candidates` returns `201`:

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "headline": "Staff engineer",
  "source": "REFERRAL", "resumeText": "…" }
```

`source` is one of `MANUAL`, `REFERRAL`, `JOB_BOARD`, `OUTREACH` or `OTHER`. Emails are unique per workspace.

### Applications

`GET /api/v1/jobs/{id}/applications?q=&stage=&sort=score|newest|oldest&after=`

`GET /api/v1/applications/{id}` includes `aiScore`, `aiSummary` and the
per-requirement `evaluations` (`verdict` `STRONG`/`PARTIAL`/`MISSING`, with
quoted `evidence`). They are empty when the key's creator can't see scores.

`POST /api/v1/applications` attaches a candidate to a job and returns `201`:

```json
{ "jobId": "…", "candidateId": "…" }
```

`PATCH /api/v1/applications/{id}` moves the stage:

```json
{ "stage": "INTERVIEW" }
```

Stages are `NEW`, `SCREENING`, `SHORTLISTED`, `INTERVIEW`, `OFFER`, `HIRED`
and `REJECTED`.

`POST /api/v1/applications/{id}/score` queues AI scoring and answers `202`
with `{ outcome, run }`. `outcome` is `queued`, `in_progress` (a run is
already going) or `reused` (the resume and job haven't changed since the last
score, so that score stands). Subscribe to `application.scored` for the
result rather than polling.

## Webhooks

Admins add endpoints in **Settings → API**: a public `https` URL and the
events to send. The signing secret is shown once. ResumeRank `POST`s one
event per request:

```json
{
  "id": "evt_6f1c…",
  "type": "application.stage_changed",
  "createdAt": "2026-10-20T12:00:00.000Z",
  "data": {
    "application": { "id": "…", "jobId": "…", "candidateId": "…", "stage": "INTERVIEW",
                     "aiScore": 82, "createdAt": "…" },
    "previousStage": "SHORTLISTED"
  }
}
```

| Event | Sent when | Extra `data` |
|---|---|---|
| `application.created` | A candidate is attached to a job | none |
| `application.stage_changed` | An application moves to a different stage | `previousStage` |
| `application.scored` | An AI scoring run finishes | `scoringRunId` |
| `ping` | An admin clicks "Send a test event" | `message` |

Headers: `ResumeRank-Event`, `ResumeRank-Delivery` (unique per endpoint and
event), and `ResumeRank-Signature: t=<unix seconds>,v1=<hex>`.

**Verify every request.** `v1` is HMAC-SHA256 of `"<t>.<raw body>"` with your
signing secret. Compare it in constant time, and reject requests whose `t` is
more than a few minutes old:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody: string, header: string, secret: string, toleranceSeconds = 300): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const [, t, v1] = match;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, "hex"));
}
```

**Delivery.**

- Any `2xx` within 10 seconds counts as delivered. Redirects are not
  followed.
- Anything else is retried with backoff (1, 2, 4 … minutes, capped at an
  hour). After 10 attempts, about four hours, the delivery is marked failed.
- Delivery is **at least once and unordered**, so dedupe on the payload `id`.
  To get the current state, read `data.application.stage` or fetch the
  application, rather than relying on arrival order.
- A paused endpoint still collects events and sends them all when resumed.
  Remove an endpoint you no longer want rather than leaving it paused.
- Settings → API shows each endpoint's last 10 deliveries and its last
  error.
