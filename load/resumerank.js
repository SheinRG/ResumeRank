// k6 load test for the paths that carry production traffic: the public API's
// reads (ranked applicant lists are the heaviest query), score requests, and
// the signed-in dashboard. Run it against staging, never production:
//
//   k6 run -e BASE_URL=https://staging.example.com -e API_KEY=rr_… \
//     -e EMAIL=… -e PASSWORD=… load/resumerank.js
//
// Score requests are sent only for applications that are already scored.
// While the model and prompt are the ones that scored them, they take the
// "reused" path and never call the model. After a model or prompt change,
// the first request for each application queues one real run (later ones
// see it in progress, then reuse it), so a run costs at most one model call
// per application. The API scenario stays under the key's 600 requests/minute
// limit.

import { check, fail } from "k6";
import http from "k6/http";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3105").replace(/\/$/, "");
const API_KEY = __ENV.API_KEY;
const EMAIL = __ENV.EMAIL;
const PASSWORD = __ENV.PASSWORD;
const DURATION = __ENV.DURATION || "2m";

export const options = {
  scenarios: {
    api_reads: {
      executor: "constant-arrival-rate",
      rate: 6,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: "apiReads",
      tags: { path: "api_reads" },
    },
    scoring: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 3,
      maxVUs: 10,
      exec: "scoreRequests",
      tags: { path: "scoring" },
    },
    dashboard: {
      executor: "constant-vus",
      vus: 3,
      duration: DURATION,
      exec: "dashboard",
      tags: { path: "dashboard" },
    },
  },
  thresholds: {
    "http_req_failed{path:api_reads}": ["rate<0.01"],
    "http_req_failed{path:scoring}": ["rate<0.01"],
    "http_req_failed{path:dashboard}": ["rate<0.01"],
    "http_req_duration{path:api_reads}": ["p(95)<800"],
    "http_req_duration{path:scoring}": ["p(95)<1000"],
    "http_req_duration{path:dashboard}": ["p(95)<2000"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function api(path, params = {}) {
  return http.get(`${BASE_URL}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    ...params,
  });
}

/** Auth.js credentials sign-in: CSRF token, then the callback, which sets the session cookie. */
function signIn() {
  const jar = http.cookieJar();
  const csrf = http.get(`${BASE_URL}/api/auth/csrf`);
  const csrfToken = csrf.json("csrfToken");
  const response = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    { email: EMAIL, password: PASSWORD, csrfToken, redirect: "false", callbackUrl: `${BASE_URL}/dashboard` },
    { redirects: 0 },
  );
  if (response.status >= 400) fail(`sign-in failed with ${response.status}`);
  const cookies = jar.cookiesForURL(`${BASE_URL}/`);
  const name = ["__Secure-authjs.session-token", "authjs.session-token"].find((cookie) => cookies[cookie]);
  if (!name) fail("sign-in set no session cookie: check EMAIL/PASSWORD, and that the account has no second factor");
  return `${name}=${cookies[name][0]}`;
}

/**
 * Runs once: signs in for the dashboard, and collects ids to read and score
 * so every iteration hits real rows. Only applications that already have a
 * score are used for score requests.
 */
export function setup() {
  if (!API_KEY || !EMAIL || !PASSWORD) fail("Set BASE_URL, API_KEY, EMAIL and PASSWORD.");
  const jobs = api("/jobs?status=OPEN").json("data") || [];
  if (jobs.length === 0) fail("The workspace has no open jobs to read.");

  const jobIds = jobs.map((job) => job.id);
  const scored = [];
  for (const jobId of jobIds.slice(0, 5)) {
    const applications = api(`/jobs/${jobId}/applications?sort=score`).json("data") || [];
    for (const application of applications) {
      if (application.aiScore !== null) scored.push(application.id);
    }
  }
  return { jobIds, scored, cookie: signIn() };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function apiReads(data) {
  const jobId = pick(data.jobIds);
  const roll = Math.random();
  let response;
  if (roll < 0.4) response = api(`/jobs/${jobId}/applications?sort=score`, { tags: { name: "ranked applicants" } });
  else if (roll < 0.6) response = api(`/jobs/${jobId}`, { tags: { name: "job" } });
  else if (roll < 0.8) response = api("/candidates?q=engineer", { tags: { name: "candidate search" } });
  else response = api("/jobs?sort=newest", { tags: { name: "jobs" } });
  check(response, { "api read is 200": (r) => r.status === 200 });
}

export function scoreRequests(data) {
  if (data.scored.length === 0) return;
  const response = http.post(`${BASE_URL}/api/v1/applications/${pick(data.scored)}/score`, null, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    tags: { name: "score request" },
  });
  check(response, {
    "score request is accepted": (r) => r.status === 202,
    "score request reuses the earlier score": (r) => r.status === 202 && r.json("outcome") === "reused",
  });
}

export function dashboard(data) {
  const response = http.get(`${BASE_URL}/dashboard`, {
    headers: { Cookie: data.cookie },
    redirects: 0,
    // A lost session redirects to /login; that is a failure, not a fast page.
    responseCallback: http.expectedStatuses(200),
    tags: { name: "dashboard" },
  });
  check(response, { "dashboard renders": (r) => r.status === 200 });
}

/** A compact JSON summary the nightly job compares with the committed baseline. */
export function handleSummary(data) {
  const paths = ["api_reads", "scoring", "dashboard"];
  const summary = {};
  for (const path of paths) {
    // A path that made no requests (setup failed, scenario skipped) reports
    // zeros; null makes the comparison fail instead of reading it as fast.
    const duration = data.metrics[`http_req_duration{path:${path}}`];
    const ran = duration && duration.values.max > 0;
    const failed = data.metrics[`http_req_failed{path:${path}}`];
    summary[path] = {
      p95: ran ? Math.round(duration.values["p(95)"]) : null,
      p99: ran ? Math.round(duration.values["p(99)"]) : null,
      errorRate: ran && failed ? failed.values.rate : null,
    };
  }
  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    [__ENV.SUMMARY_PATH || "load/summary.json"]: JSON.stringify(summary, null, 2),
  };
}
