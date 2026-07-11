import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type {
  CandidateSource,
  RequirementWeight,
  Stage,
  Verdict,
} from "../src/generated/prisma/enums";
import { computeScore } from "../src/lib/scoring/math";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * DAY);

interface SeedRequirement {
  label: string;
  weight: RequirementWeight;
}

interface SeedJob {
  key: string;
  title: string;
  location: string;
  description: string;
  requirements: SeedRequirement[];
  createdDaysAgo: number;
}

interface SeedCandidate {
  key: string;
  name: string;
  email: string;
  headline: string;
  source: CandidateSource;
  resumeText: string;
  createdDaysAgo: number;
}

interface SeedEvaluation {
  requirementIndex: number;
  verdict: Verdict;
  evidence: string | null;
  note: string;
}

interface SeedApplication {
  jobKey: string;
  candidateKey: string;
  stage: Stage;
  createdDaysAgo: number;
  summary?: string;
  evaluations?: SeedEvaluation[];
}

const jobs: SeedJob[] = [
  {
    key: "frontend",
    title: "Senior Frontend Engineer",
    location: "Remote (EU/IST overlap)",
    createdDaysAgo: 42,
    description:
      "We are hiring a senior frontend engineer to own the customer-facing dashboard of our analytics platform. You will lead the migration to the Next.js App Router, own our design system, and set the performance bar for a product used daily by 40,000 operators. You will work directly with design and ship end to end — no ticket-taking.",
    requirements: [
      { label: "5+ years building production React applications", weight: "MUST" },
      { label: "Deep TypeScript expertise in strict mode", weight: "MUST" },
      { label: "Has owned a design system or component library", weight: "MUST" },
      { label: "Performance profiling and Core Web Vitals optimization", weight: "MUST" },
      { label: "Next.js App Router experience", weight: "NICE" },
      { label: "Has mentored other engineers", weight: "NICE" },
    ],
  },
  {
    key: "backend",
    title: "Backend Engineer — Node & Postgres",
    location: "Hybrid, Bengaluru",
    createdDaysAgo: 35,
    description:
      "You will design and operate the APIs behind our billing and ingestion pipeline: Node.js services on Postgres handling ~2,000 requests/second at peak. The work is schema design, query optimization, queue-driven workflows, and making the system observable enough that on-call is boring.",
    requirements: [
      { label: "4+ years designing REST or GraphQL APIs in Node.js", weight: "MUST" },
      { label: "Strong PostgreSQL schema design and query optimization", weight: "MUST" },
      { label: "Production experience with queues or event-driven systems", weight: "MUST" },
      { label: "Observability: metrics, tracing, structured logging", weight: "NICE" },
      { label: "AWS deployment and infrastructure-as-code experience", weight: "NICE" },
    ],
  },
  {
    key: "designer",
    title: "Product Designer",
    location: "Remote",
    createdDaysAgo: 21,
    description:
      "First dedicated design hire. You will own the end-to-end design of a B2B recruiting product: flows, systems, and the craft details that make software feel inevitable. You will work from research to shipped UI with one designer-founder as your partner.",
    requirements: [
      { label: "3+ years designing B2B SaaS products end to end", weight: "MUST" },
      { label: "Systems thinking: tokens, components, documentation", weight: "MUST" },
      { label: "High-fidelity prototyping in Figma", weight: "MUST" },
      { label: "Has planned and run usability research", weight: "NICE" },
    ],
  },
];

const candidates: SeedCandidate[] = [
  {
    key: "priya",
    name: "Priya Sharma",
    email: "priya.sharma@example.com",
    headline: "Senior Frontend Engineer · React, TypeScript, design systems",
    source: "JOB_BOARD",
    createdDaysAgo: 38,
    resumeText: `SUMMARY
Frontend engineer with 7 years of experience building production React applications for fintech and SaaS. I care about type safety, rendering performance, and interfaces that stay fast as they grow.

EXPERIENCE
Senior Frontend Engineer — Finlay (2021–present)
- Led the frontend for a payments dashboard serving 60k merchants, built in React 18 and TypeScript strict mode with zero any across the codebase.
- Owned the design system: 42 components on Radix primitives with tokens consumed by three product teams, cutting new-screen build time by half.
- Drove Core Web Vitals work that took LCP from 4.1s to 1.8s: route-level code splitting, image preloading, and eliminating layout shift from async panels.
- Migrated the app shell to the Next.js App Router with server components for data-heavy views.
- Mentored four mid-level engineers through a structured RFC-and-review loop; two promoted to senior.

Frontend Engineer — Zaply (2018–2021)
- Built the onboarding flow that lifted activation 22%; introduced TypeScript to a 120k-line JavaScript codebase incrementally.

SKILLS
React, TypeScript, Next.js, Radix, Tailwind, Playwright, Web Vitals, Storybook`,
  },
  {
    key: "lena",
    name: "Lena Fischer",
    email: "lena.fischer@example.com",
    headline: "Staff Frontend Engineer · design systems at scale",
    source: "REFERRAL",
    createdDaysAgo: 30,
    resumeText: `SUMMARY
Staff-level frontend engineer, 9 years in. I build the platforms other frontend engineers stand on: design systems, build tooling, and performance budgets that hold.

EXPERIENCE
Staff Frontend Engineer — Helios HR (2020–present)
- Created and still own a design system used by 11 teams and 90+ engineers; governance model, versioned releases, and codemods for breaking changes.
- Set and enforced a performance budget in CI; the product ships at LCP 1.6s p75 and CLS under 0.05 measured in the field.
- Nine years of production React, TypeScript strict everywhere since 2019.
- Run the frontend guild and mentor senior engineers toward staff scope.

Senior Engineer — Trivago (2016–2020)
- Search results page team; rendering performance on low-end Android was the whole job.

NOTE
Next.js experience is Pages Router; App Router only in side projects so far.

SKILLS
React, TypeScript, design tokens, Storybook, esbuild, Lighthouse CI, mentoring`,
  },
  {
    key: "daniel",
    name: "Daniel Okoye",
    email: "daniel.okoye@example.com",
    headline: "Frontend Engineer · React + TypeScript",
    source: "JOB_BOARD",
    createdDaysAgo: 26,
    resumeText: `SUMMARY
Frontend engineer with 4 years of React experience across two startups. Fast learner, strong on product intuition, still growing into platform-level work.

EXPERIENCE
Frontend Engineer — CartStack (2022–present)
- Ship customer-facing features in React and TypeScript for an e-commerce analytics tool.
- Consumed and contributed fixes to the internal component library (did not own it).
- Improved dashboard load time by lazy-loading chart bundles; haven't done systematic Web Vitals work.

Junior Frontend Engineer — Novi Labs (2020–2022)
- Built marketing pages and the first version of the settings area in React.

SKILLS
React, TypeScript, Redux Toolkit, Tailwind, Jest, Vite`,
  },
  {
    key: "sofia",
    name: "Sofia Ivanova",
    email: "sofia.ivanova@example.com",
    headline: "Full-stack Engineer · React front, Node back",
    source: "OUTREACH",
    createdDaysAgo: 24,
    resumeText: `SUMMARY
Full-stack engineer, 6 years, roughly 60/40 frontend/backend. I like owning a feature from schema to screen.

EXPERIENCE
Senior Engineer — Meridian Health (2021–present)
- Own patient-scheduling features end to end: React + TypeScript frontend, Node.js REST APIs on PostgreSQL.
- Built the shared form component kit used across four squads and documented its patterns.
- Designed Postgres schemas for scheduling and wrote the pg_stat_statements-driven optimization pass that cut p95 query time 40%.
- Used BullMQ for appointment-reminder jobs.
- Profiled and fixed the worst interaction-latency screens flagged by our RUM data.

Engineer — Freelance (2018–2021)
- Delivered a dozen production React apps and Node backends for clients.

SKILLS
React, TypeScript, Next.js (App Router in production since 2024), Node.js, PostgreSQL, BullMQ, Prisma`,
  },
  {
    key: "marcus",
    name: "Marcus Webb",
    email: "marcus.webb@example.com",
    headline: "Web Developer · 12 years, enterprise",
    source: "JOB_BOARD",
    createdDaysAgo: 22,
    resumeText: `SUMMARY
Veteran web developer with 12 years of experience, primarily on enterprise intranet applications. Deep jQuery and AngularJS background, some React exposure.

EXPERIENCE
Lead Web Developer — Corvus Insurance Systems (2015–present)
- Maintain a suite of internal underwriting tools built on AngularJS and jQuery.
- Completed one migration pilot of a small module to React 16 with class components in 2021.
- JavaScript throughout; the team evaluated TypeScript but has not adopted it.

Web Developer — HCL (2012–2015)
- SharePoint customizations and internal portals.

SKILLS
JavaScript, jQuery, AngularJS, some React, CSS, SQL Server`,
  },
  {
    key: "emma",
    name: "Emma Johansson",
    email: "emma.johansson@example.com",
    headline: "Frontend Developer · recent bootcamp graduate",
    source: "JOB_BOARD",
    createdDaysAgo: 5,
    resumeText: `SUMMARY
Career changer (previously a graphic designer) who completed an intensive full-stack bootcamp in 2025. Hungry, detail-oriented, strong visual instincts.

PROJECTS
- Recipe-sharing app in React and TypeScript with Supabase backend; deployed on Netlify.
- Portfolio site scoring 100 on Lighthouse performance.
- Contributed two merged PRs to an open-source component library (documentation and a bug fix).

EXPERIENCE
Graphic Designer — Studio Malmö (2019–2024)
- Brand systems and marketing design for 30+ clients.

SKILLS
React, TypeScript (learning strict mode), Tailwind, Figma, Supabase`,
  },
  {
    key: "rahul",
    name: "Rahul Mehta",
    email: "rahul.mehta@example.com",
    headline: "Senior Backend Engineer · Node, Postgres, event-driven",
    source: "REFERRAL",
    createdDaysAgo: 32,
    resumeText: `SUMMARY
Backend engineer with 8 years building high-throughput Node.js services. Postgres is my home turf; I think in schemas and query plans.

EXPERIENCE
Senior Backend Engineer — Swiggy (2021–present)
- Design and operate order-state APIs in Node.js handling 3k rps peak, REST and internal gRPC.
- Redesigned the order-history schema with partitioned tables and covering indexes, cutting p99 read latency from 900ms to 70ms.
- Own the Kafka-based event pipeline for order lifecycle events; exactly-once consumer semantics with idempotency keys.
- Instrumented services with OpenTelemetry traces, Prometheus metrics, and structured pino logging feeding Grafana dashboards.
- Deploy on AWS (ECS Fargate) with Terraform modules maintained by the team.

Backend Engineer — Razorpay (2017–2021)
- Payment webhook delivery system with retry queues on SQS.

SKILLS
Node.js, TypeScript, PostgreSQL, Kafka, SQS, Redis, Terraform, OpenTelemetry`,
  },
  {
    key: "grace",
    name: "Grace Liu",
    email: "grace.liu@example.com",
    headline: "Backend Engineer · APIs & data modeling",
    source: "JOB_BOARD",
    createdDaysAgo: 20,
    resumeText: `SUMMARY
Backend engineer with 5 years of Node.js API work, strongest on relational data modeling and API ergonomics.

EXPERIENCE
Backend Engineer — Plately (2021–present)
- Built and version the public GraphQL API for a restaurant-management platform in Node.js.
- Design all PostgreSQL schemas; introduced RLS for tenant isolation and wrote the team's migration guidelines.
- Optimized menu-search queries with trigram indexes after profiling with EXPLAIN ANALYZE.
- Batch jobs run on cron; we have not needed a real queue system yet.
- Basic logging with Winston; no tracing or metrics stack in place.

Junior Engineer — Accenture (2019–2021)
- Java Spring services for a retail client.

SKILLS
Node.js, TypeScript, GraphQL, PostgreSQL, Docker, Redis`,
  },
  {
    key: "tom",
    name: "Tom Baker",
    email: "tom.baker@example.com",
    headline: "Platform / DevOps Engineer",
    source: "OUTREACH",
    createdDaysAgo: 3,
    resumeText: `SUMMARY
Platform engineer with 6 years across DevOps and backend support work. Strongest on infrastructure; looking to move closer to product backend work.

EXPERIENCE
Platform Engineer — Ocado Technology (2020–present)
- Own Kubernetes clusters and CI/CD pipelines for 30 services; Terraform for all AWS infrastructure.
- Built internal Grafana/Prometheus observability stack adopted by every backend team.
- Wrote small Node.js internal tools (deploy bots, cost reporting) but have not owned a production API service.
- Comfortable reading and tuning Postgres at the infrastructure level (connection pooling, replicas), less so at schema-design level.

SKILLS
Kubernetes, Terraform, AWS, Prometheus, Grafana, Node.js (tooling), PostgreSQL (ops), Bash`,
  },
  {
    key: "nadia",
    name: "Nadia Hassan",
    email: "nadia.hassan@example.com",
    headline: "Product Designer · B2B SaaS, systems-first",
    source: "REFERRAL",
    createdDaysAgo: 15,
    resumeText: `SUMMARY
Product designer with 6 years designing B2B SaaS end to end — from discovery research to shipped, measured UI. Systems-first: I design the component before the screen.

EXPERIENCE
Senior Product Designer — Deel (2022–present)
- Own contractor-onboarding flows end to end: research, flows, high-fidelity Figma prototypes, and QA with engineers.
- Co-built the design token architecture (color, space, type) and documented usage for 40+ designers and engineers.
- Planned and ran 30+ moderated usability sessions; my onboarding redesign cut time-to-first-contract by 35%.

Product Designer — Zoho (2019–2022)
- CRM pipeline views and reporting dashboards for SMB customers.

SKILLS
Figma (advanced prototyping, variables), design tokens, usability research, Maze, FigJam`,
  },
  {
    key: "chris",
    name: "Chris Park",
    email: "chris.park@example.com",
    headline: "Visual & Brand Designer",
    source: "MANUAL",
    createdDaysAgo: 10,
    resumeText: `SUMMARY
Visual designer with 5 years in brand and marketing design, transitioning into product design. Exceptional craft on the visual layer; newer to end-to-end product process.

EXPERIENCE
Brand Designer — Studio Hyphen (2021–present)
- Brand identities, landing pages, and campaign assets for 25+ tech clients.
- Designed marketing-site components in Figma handed to development teams.
- One product engagement: redesigned the visual layer of a booking tool's dashboard (flows owned by the client's PM).

Designer — Freelance (2019–2021)
- Logos, decks, and social assets.

SKILLS
Figma, Illustrator, After Effects, Webflow, typography, art direction`,
  },
  {
    key: "alex",
    name: "Alex Turner",
    email: "alex.turner@example.com",
    headline: "Backend Engineer · Node & Postgres",
    source: "REFERRAL",
    createdDaysAgo: 33,
    resumeText: `SUMMARY
Backend engineer, 6 years, all of it on Node.js services backed by PostgreSQL. Pragmatic, delivery-focused, strong reviewer.

EXPERIENCE
Backend Engineer — Wise (2020–present)
- Built REST APIs for the recipients domain in Node.js/TypeScript serving 1.2k rps.
- Redesigned recipient-dedup schema; wrote the batched backfill that migrated 40M rows with zero downtime.
- Moved notification fan-out to SQS with a dead-letter strategy that cut duplicate sends to zero.
- Added RED-method metrics and structured logs to every service the team owns.
- Deployed via CDK pipelines on AWS.

Engineer — TransferGo (2018–2020)
- Payments reconciliation services.

SKILLS
Node.js, TypeScript, PostgreSQL, SQS, Redis, AWS CDK, Datadog`,
  },
];

const applications: SeedApplication[] = [
  {
    jobKey: "frontend",
    candidateKey: "priya",
    stage: "SHORTLISTED",
    createdDaysAgo: 37,
    summary:
      "Exceptional fit. Seven years of production React with genuine design-system ownership, measured Core Web Vitals wins, and App Router migration experience. Mentoring track record is a bonus. The strongest frontend profile in this pipeline.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "STRONG",
        evidence:
          "Frontend engineer with 7 years of experience building production React applications for fintech and SaaS.",
        note: "Seven years of production React, two years past the bar, all in shipped product work.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence:
          "built in React 18 and TypeScript strict mode with zero any across the codebase",
        note: "Strict mode at codebase scale with an explicit zero-any standard — exactly the requirement.",
      },
      {
        requirementIndex: 2,
        verdict: "STRONG",
        evidence:
          "Owned the design system: 42 components on Radix primitives with tokens consumed by three product teams",
        note: "Clear ownership (not just contribution) of a multi-team design system.",
      },
      {
        requirementIndex: 3,
        verdict: "STRONG",
        evidence:
          "Drove Core Web Vitals work that took LCP from 4.1s to 1.8s",
        note: "Named metrics with before/after numbers — measured performance work, not claimed.",
      },
      {
        requirementIndex: 4,
        verdict: "STRONG",
        evidence:
          "Migrated the app shell to the Next.js App Router with server components for data-heavy views.",
        note: "Direct App Router migration experience in production.",
      },
      {
        requirementIndex: 5,
        verdict: "STRONG",
        evidence:
          "Mentored four mid-level engineers through a structured RFC-and-review loop; two promoted to senior.",
        note: "Structured mentoring with promotion outcomes.",
      },
    ],
  },
  {
    jobKey: "frontend",
    candidateKey: "lena",
    stage: "INTERVIEW",
    createdDaysAgo: 29,
    summary:
      "Staff-level systems builder: a design system serving 11 teams, CI-enforced performance budgets, and nine years of React. Only gap is App Router exposure, which is a nice-to-have. Interview should probe product-feature appetite vs. pure platform work.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "STRONG",
        evidence: "Nine years of production React, TypeScript strict everywhere since 2019.",
        note: "Nine years, well past the five-year bar.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence: "TypeScript strict everywhere since 2019",
        note: "Six years of strict-mode TypeScript as a default, not an aspiration.",
      },
      {
        requirementIndex: 2,
        verdict: "STRONG",
        evidence:
          "Created and still own a design system used by 11 teams and 90+ engineers; governance model, versioned releases, and codemods for breaking changes.",
        note: "The strongest possible signal: created, owns, and governs a system at scale.",
      },
      {
        requirementIndex: 3,
        verdict: "STRONG",
        evidence:
          "Set and enforced a performance budget in CI; the product ships at LCP 1.6s p75 and CLS under 0.05 measured in the field.",
        note: "Field-measured vitals with CI enforcement — beyond the requirement.",
      },
      {
        requirementIndex: 4,
        verdict: "PARTIAL",
        evidence:
          "Next.js experience is Pages Router; App Router only in side projects so far.",
        note: "Honest gap: production experience is Pages Router; App Router is side-project depth only.",
      },
      {
        requirementIndex: 5,
        verdict: "STRONG",
        evidence: "Run the frontend guild and mentor senior engineers toward staff scope.",
        note: "Mentors at senior→staff level, above the bar.",
      },
    ],
  },
  {
    jobKey: "frontend",
    candidateKey: "sofia",
    stage: "SHORTLISTED",
    createdDaysAgo: 23,
    summary:
      "Strong generalist with real App Router production time and end-to-end ownership. Design-system experience is component-kit scale rather than org scale, and React tenure is slightly under the bar if you count only frontend-weighted years.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "PARTIAL",
        evidence:
          "Full-stack engineer, 6 years, roughly 60/40 frontend/backend.",
        note: "Six years total but split with backend; frontend-weighted experience is near, not clearly past, five years.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence: "React + TypeScript frontend, Node.js REST APIs on PostgreSQL.",
        note: "TypeScript across the stack in production for four years.",
      },
      {
        requirementIndex: 2,
        verdict: "PARTIAL",
        evidence:
          "Built the shared form component kit used across four squads and documented its patterns.",
        note: "Built and documented a shared kit — real, but narrower than owning a full design system.",
      },
      {
        requirementIndex: 3,
        verdict: "PARTIAL",
        evidence:
          "Profiled and fixed the worst interaction-latency screens flagged by our RUM data.",
        note: "Has done targeted RUM-driven fixes; no evidence of systematic Web Vitals ownership.",
      },
      {
        requirementIndex: 4,
        verdict: "STRONG",
        evidence: "Next.js (App Router in production since 2024)",
        note: "Production App Router experience for over a year.",
      },
      {
        requirementIndex: 5,
        verdict: "MISSING",
        evidence: null,
        note: "No mentoring or coaching signal anywhere in the resume.",
      },
    ],
  },
  {
    jobKey: "frontend",
    candidateKey: "marcus",
    stage: "REJECTED",
    createdDaysAgo: 21,
    summary:
      "Deep web experience but in the wrong stack for this role: twelve years of jQuery/AngularJS with one small React pilot and no TypeScript adoption. Every must-have is missing or marginal. Not a fit for a senior React role today.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "MISSING",
        evidence:
          "Completed one migration pilot of a small module to React 16 with class components in 2021.",
        note: "React exposure is a single 2021 pilot, not years of production work.",
      },
      {
        requirementIndex: 1,
        verdict: "MISSING",
        evidence:
          "JavaScript throughout; the team evaluated TypeScript but has not adopted it.",
        note: "No TypeScript at all, let alone strict mode.",
      },
      {
        requirementIndex: 2,
        verdict: "MISSING",
        evidence: null,
        note: "No design-system or component-library work mentioned.",
      },
      {
        requirementIndex: 3,
        verdict: "MISSING",
        evidence: null,
        note: "No performance or Web Vitals work mentioned.",
      },
      {
        requirementIndex: 4,
        verdict: "MISSING",
        evidence: null,
        note: "No Next.js experience mentioned.",
      },
      {
        requirementIndex: 5,
        verdict: "PARTIAL",
        evidence: "Lead Web Developer — Corvus Insurance Systems (2015–present)",
        note: "Lead title implies some coaching, but nothing explicit about mentoring.",
      },
    ],
  },
  {
    jobKey: "frontend",
    candidateKey: "daniel",
    stage: "SCREENING",
    createdDaysAgo: 25,
    summary:
      "Promising mid-level profile: four years of React/TypeScript and good product instincts, but short of the senior bar on tenure, and no design-system ownership or systematic performance work yet. Worth a screen if the level is flexible.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "PARTIAL",
        evidence:
          "Frontend engineer with 4 years of React experience across two startups.",
        note: "Four years against a five-year bar — close but under.",
      },
      {
        requirementIndex: 1,
        verdict: "PARTIAL",
        evidence: "Ship customer-facing features in React and TypeScript",
        note: "Daily TypeScript, but no strict-mode or type-architecture signal.",
      },
      {
        requirementIndex: 2,
        verdict: "MISSING",
        evidence:
          "Consumed and contributed fixes to the internal component library (did not own it).",
        note: "Explicitly a consumer, not an owner, of the component library.",
      },
      {
        requirementIndex: 3,
        verdict: "PARTIAL",
        evidence:
          "Improved dashboard load time by lazy-loading chart bundles; haven't done systematic Web Vitals work.",
        note: "One-off optimization; candidate himself flags the lack of systematic vitals work.",
      },
      {
        requirementIndex: 4,
        verdict: "MISSING",
        evidence: null,
        note: "No Next.js experience listed; stack is Vite + Redux.",
      },
      {
        requirementIndex: 5,
        verdict: "MISSING",
        evidence: null,
        note: "No mentoring signal; has been the junior in both roles.",
      },
    ],
  },
  {
    jobKey: "frontend",
    candidateKey: "emma",
    stage: "NEW",
    createdDaysAgo: 4,
  },
  {
    jobKey: "backend",
    candidateKey: "rahul",
    stage: "INTERVIEW",
    createdDaysAgo: 31,
    summary:
      "Outstanding match across every requirement: eight years of high-throughput Node APIs, deep Postgres work with quantified wins, real Kafka ownership, and a full observability stack. Fast-track this one.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "STRONG",
        evidence:
          "Design and operate order-state APIs in Node.js handling 3k rps peak, REST and internal gRPC.",
        note: "Eight years designing high-throughput Node APIs, double the bar.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence:
          "Redesigned the order-history schema with partitioned tables and covering indexes, cutting p99 read latency from 900ms to 70ms.",
        note: "Advanced Postgres work (partitioning, covering indexes) with quantified impact.",
      },
      {
        requirementIndex: 2,
        verdict: "STRONG",
        evidence:
          "Own the Kafka-based event pipeline for order lifecycle events; exactly-once consumer semantics with idempotency keys.",
        note: "Owns an event pipeline and speaks to delivery semantics — deep, not incidental.",
      },
      {
        requirementIndex: 3,
        verdict: "STRONG",
        evidence:
          "Instrumented services with OpenTelemetry traces, Prometheus metrics, and structured pino logging feeding Grafana dashboards.",
        note: "All three observability pillars in place.",
      },
      {
        requirementIndex: 4,
        verdict: "STRONG",
        evidence:
          "Deploy on AWS (ECS Fargate) with Terraform modules maintained by the team.",
        note: "AWS + Terraform in daily use.",
      },
    ],
  },
  {
    jobKey: "backend",
    candidateKey: "alex",
    stage: "HIRED",
    createdDaysAgo: 30,
    summary:
      "Very strong: six years of Node/Postgres with a serious zero-downtime migration story and production SQS ownership. Slightly lighter than Rahul on observability breadth. Hired.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "STRONG",
        evidence:
          "Built REST APIs for the recipients domain in Node.js/TypeScript serving 1.2k rps.",
        note: "Six years of production Node API work at meaningful scale.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence:
          "Redesigned recipient-dedup schema; wrote the batched backfill that migrated 40M rows with zero downtime.",
        note: "Schema redesign plus a 40M-row zero-downtime migration — senior-level Postgres work.",
      },
      {
        requirementIndex: 2,
        verdict: "STRONG",
        evidence:
          "Moved notification fan-out to SQS with a dead-letter strategy that cut duplicate sends to zero.",
        note: "Queue ownership with failure-mode thinking (DLQ, idempotency).",
      },
      {
        requirementIndex: 3,
        verdict: "PARTIAL",
        evidence:
          "Added RED-method metrics and structured logs to every service the team owns.",
        note: "Metrics and logging are solid; no tracing experience mentioned.",
      },
      {
        requirementIndex: 4,
        verdict: "STRONG",
        evidence: "Deployed via CDK pipelines on AWS.",
        note: "AWS with CDK infrastructure-as-code.",
      },
    ],
  },
  {
    jobKey: "backend",
    candidateKey: "sofia",
    stage: "SCREENING",
    createdDaysAgo: 22,
    summary:
      "Capable full-stack engineer with genuine Postgres optimization experience and light queue usage. Backend depth is real but split with frontend focus; queue experience is job-scheduling scale rather than event-driven architecture.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "PARTIAL",
        evidence: "Node.js REST APIs on PostgreSQL",
        note: "Builds production APIs, but backend is the minority share of a 60/40 split role.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence:
          "Designed Postgres schemas for scheduling and wrote the pg_stat_statements-driven optimization pass that cut p95 query time 40%.",
        note: "Profiling-driven optimization with measured results.",
      },
      {
        requirementIndex: 2,
        verdict: "PARTIAL",
        evidence: "Used BullMQ for appointment-reminder jobs.",
        note: "Has used a queue, but for scheduled jobs — not event-driven system design.",
      },
      {
        requirementIndex: 3,
        verdict: "MISSING",
        evidence: null,
        note: "No metrics, tracing, or logging stack mentioned.",
      },
      {
        requirementIndex: 4,
        verdict: "MISSING",
        evidence: null,
        note: "No AWS or infrastructure-as-code experience mentioned.",
      },
    ],
  },
  {
    jobKey: "backend",
    candidateKey: "grace",
    stage: "SCREENING",
    createdDaysAgo: 18,
    summary:
      "Strong API and data-modeling fundamentals — the GraphQL and Postgres work is exactly on target. The hard gap is queues/event-driven systems, which is a must-have, plus thin observability. Screen to gauge how fast she'd close the queue gap.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "STRONG",
        evidence:
          "Built and version the public GraphQL API for a restaurant-management platform in Node.js.",
        note: "Five years, owns a public versioned API — solid.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence:
          "Optimized menu-search queries with trigram indexes after profiling with EXPLAIN ANALYZE.",
        note: "Schema ownership plus real query-plan-level optimization.",
      },
      {
        requirementIndex: 2,
        verdict: "MISSING",
        evidence:
          "Batch jobs run on cron; we have not needed a real queue system yet.",
        note: "Candidate states no queue experience — a must-have gap.",
      },
      {
        requirementIndex: 3,
        verdict: "PARTIAL",
        evidence: "Basic logging with Winston; no tracing or metrics stack in place.",
        note: "Logging only; no metrics or tracing.",
      },
      {
        requirementIndex: 4,
        verdict: "MISSING",
        evidence: null,
        note: "Docker experience only; no cloud deployment or IaC signal.",
      },
    ],
  },
  {
    jobKey: "backend",
    candidateKey: "tom",
    stage: "NEW",
    createdDaysAgo: 2,
  },
  {
    jobKey: "designer",
    candidateKey: "nadia",
    stage: "OFFER",
    createdDaysAgo: 14,
    summary:
      "Excellent fit for a first design hire: end-to-end B2B SaaS ownership at Deel, token-level systems work documented for a large org, advanced Figma prototyping, and a strong research practice with measured outcomes.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "STRONG",
        evidence:
          "Own contractor-onboarding flows end to end: research, flows, high-fidelity Figma prototypes, and QA with engineers.",
        note: "Six years of end-to-end B2B SaaS design at serious companies.",
      },
      {
        requirementIndex: 1,
        verdict: "STRONG",
        evidence:
          "Co-built the design token architecture (color, space, type) and documented usage for 40+ designers and engineers.",
        note: "Token-level systems work with documentation for a large audience.",
      },
      {
        requirementIndex: 2,
        verdict: "STRONG",
        evidence: "Figma (advanced prototyping, variables)",
        note: "Advanced prototyping including variables.",
      },
      {
        requirementIndex: 3,
        verdict: "STRONG",
        evidence:
          "Planned and ran 30+ moderated usability sessions; my onboarding redesign cut time-to-first-contract by 35%.",
        note: "Runs research at volume and ties it to outcomes.",
      },
    ],
  },
  {
    jobKey: "designer",
    candidateKey: "chris",
    stage: "NEW",
    createdDaysAgo: 9,
    summary:
      "Outstanding visual craft, but the product-design fundamentals this role needs are thin: no end-to-end B2B product ownership, no research practice, and systems experience at marketing-site depth. Better suited to a brand-design role.",
    evaluations: [
      {
        requirementIndex: 0,
        verdict: "MISSING",
        evidence:
          "One product engagement: redesigned the visual layer of a booking tool's dashboard (flows owned by the client's PM).",
        note: "Product work is one visual-layer engagement; flows were owned by someone else.",
      },
      {
        requirementIndex: 1,
        verdict: "PARTIAL",
        evidence:
          "Designed marketing-site components in Figma handed to development teams.",
        note: "Component thinking exists, but at marketing-site scope, not product-system scope.",
      },
      {
        requirementIndex: 2,
        verdict: "STRONG",
        evidence: "Figma, Illustrator, After Effects, Webflow, typography, art direction",
        note: "Figma is the daily tool; craft on the visual layer is clearly high.",
      },
      {
        requirementIndex: 3,
        verdict: "MISSING",
        evidence: null,
        note: "No research experience mentioned anywhere.",
      },
    ],
  },
];

async function main(): Promise<void> {
  console.log("Seeding ResumeRank demo workspace…");

  await db.$transaction([
    db.activityLog.deleteMany(),
    db.scorecard.deleteMany(),
    db.evaluation.deleteMany(),
    db.application.deleteMany(),
    db.jobRequirement.deleteMany(),
    db.candidate.deleteMany(),
    db.job.deleteMany(),
    db.passwordResetToken.deleteMany(),
    db.session.deleteMany(),
    db.account.deleteMany(),
    db.verificationToken.deleteMany(),
    db.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash("demo1234", 12);

  const [owner, demo, maya] = await Promise.all([
    db.user.create({
      data: {
        name: "Ava Founder",
        email: "owner@resumerank.app",
        role: "OWNER",
        passwordHash,
        emailVerified: daysAgo(60),
        createdAt: daysAgo(60),
      },
    }),
    db.user.create({
      data: {
        name: "Demo Recruiter",
        email: "demo@resumerank.app",
        role: "ADMIN",
        passwordHash,
        emailVerified: daysAgo(50),
        createdAt: daysAgo(50),
      },
    }),
    db.user.create({
      data: {
        name: "Maya Reviewer",
        email: "maya@resumerank.app",
        role: "MEMBER",
        passwordHash,
        emailVerified: daysAgo(45),
        createdAt: daysAgo(45),
      },
    }),
    db.user.create({
      data: {
        name: "Vik Observer",
        email: "viewer@resumerank.app",
        role: "VIEWER",
        passwordHash,
        emailVerified: daysAgo(40),
        createdAt: daysAgo(40),
      },
    }),
  ]);

  const jobIdByKey = new Map<string, string>();
  const requirementIdsByJob = new Map<string, string[]>();

  for (const job of jobs) {
    const created = await db.job.create({
      data: {
        title: job.title,
        description: job.description,
        location: job.location,
        status: "OPEN",
        createdById: demo.id,
        createdAt: daysAgo(job.createdDaysAgo),
        requirements: {
          create: job.requirements.map((r, i) => ({
            label: r.label,
            weight: r.weight,
            order: i,
          })),
        },
      },
      include: { requirements: { orderBy: { order: "asc" } } },
    });
    jobIdByKey.set(job.key, created.id);
    requirementIdsByJob.set(
      job.key,
      created.requirements.map((r) => r.id),
    );
    await db.activityLog.create({
      data: {
        actorId: demo.id,
        action: "job.created",
        entityType: "job",
        entityId: created.id,
        summary: `created job "${created.title}"`,
        createdAt: daysAgo(job.createdDaysAgo),
      },
    });
  }

  const candidateIdByKey = new Map<string, string>();
  for (const c of candidates) {
    const created = await db.candidate.create({
      data: {
        name: c.name,
        email: c.email,
        headline: c.headline,
        source: c.source,
        resumeText: c.resumeText,
        createdById: demo.id,
        createdAt: daysAgo(c.createdDaysAgo),
      },
    });
    candidateIdByKey.set(c.key, created.id);
    await db.activityLog.create({
      data: {
        actorId: demo.id,
        action: "candidate.created",
        entityType: "candidate",
        entityId: created.id,
        summary: `added candidate ${created.name}`,
        createdAt: daysAgo(c.createdDaysAgo),
      },
    });
  }

  const applicationIdByKey = new Map<string, string>();
  for (const a of applications) {
    const jobId = jobIdByKey.get(a.jobKey);
    const candidateId = candidateIdByKey.get(a.candidateKey);
    const requirementIds = requirementIdsByJob.get(a.jobKey);
    const job = jobs.find((j) => j.key === a.jobKey);
    const candidate = candidates.find((c) => c.key === a.candidateKey);
    if (!jobId || !candidateId || !requirementIds || !job || !candidate) {
      throw new Error(`Bad seed reference: ${a.jobKey}/${a.candidateKey}`);
    }

    const evals = a.evaluations ?? [];
    const scored = evals.length > 0;
    const aiScore = scored
      ? computeScore(
          evals.map((e) => ({
            verdict: e.verdict,
            weight: job.requirements[e.requirementIndex].weight,
          })),
        )
      : null;

    const created = await db.application.create({
      data: {
        jobId,
        candidateId,
        stage: a.stage,
        aiScore,
        aiSummary: scored ? a.summary : null,
        scoredAt: scored ? daysAgo(a.createdDaysAgo - 1) : null,
        createdById: demo.id,
        createdAt: daysAgo(a.createdDaysAgo),
        evaluations: scored
          ? {
              create: evals.map((e) => ({
                requirementId: requirementIds[e.requirementIndex],
                criterion: job.requirements[e.requirementIndex].label,
                weight: job.requirements[e.requirementIndex].weight,
                verdict: e.verdict,
                evidence: e.evidence,
                note: e.note,
                createdAt: daysAgo(a.createdDaysAgo - 1),
              })),
            }
          : undefined,
      },
    });
    applicationIdByKey.set(`${a.jobKey}/${a.candidateKey}`, created.id);

    await db.activityLog.create({
      data: {
        actorId: demo.id,
        action: "application.created",
        entityType: "application",
        entityId: created.id,
        summary: `added ${candidate.name} to "${job.title}"`,
        createdAt: daysAgo(a.createdDaysAgo),
      },
    });
    if (scored) {
      await db.activityLog.create({
        data: {
          actorId: demo.id,
          action: "application.scored",
          entityType: "application",
          entityId: created.id,
          summary: `scored ${candidate.name} for "${job.title}" — ${aiScore}/100`,
          createdAt: daysAgo(a.createdDaysAgo - 1),
        },
      });
    }
    if (a.stage !== "NEW") {
      await db.activityLog.create({
        data: {
          actorId: maya.id,
          action: "application.stage_changed",
          entityType: "application",
          entityId: created.id,
          summary: `moved ${candidate.name} to ${a.stage.toLowerCase()}`,
          metadata: { from: "NEW", to: a.stage },
          createdAt: daysAgo(Math.max(a.createdDaysAgo - 3, 1)),
        },
      });
    }
  }

  const scorecards: Array<{
    appKey: string;
    reviewerId: string;
    rating: number;
    notes: string;
  }> = [
    {
      appKey: "frontend/priya",
      reviewerId: maya.id,
      rating: 5,
      notes:
        "Portfolio walk-through was excellent — the design-system governance story is real. Push to onsite.",
    },
    {
      appKey: "frontend/lena",
      reviewerId: demo.id,
      rating: 4,
      notes:
        "Deep platform thinker. Want to verify she still enjoys shipping product features, not only systems.",
    },
    {
      appKey: "backend/rahul",
      reviewerId: owner.id,
      rating: 5,
      notes: "Best backend screen I've done this quarter. Move fast, he has competing offers.",
    },
    {
      appKey: "backend/alex",
      reviewerId: maya.id,
      rating: 4,
      notes: "Calm, methodical, great migration war stories. Accepted our offer.",
    },
    {
      appKey: "designer/nadia",
      reviewerId: demo.id,
      rating: 5,
      notes: "Portfolio depth on research is rare. Offer out — comp approved by Ava.",
    },
  ];

  for (const s of scorecards) {
    const applicationId = applicationIdByKey.get(s.appKey);
    if (!applicationId) throw new Error(`Bad scorecard reference: ${s.appKey}`);
    await db.scorecard.create({
      data: {
        applicationId,
        reviewerId: s.reviewerId,
        rating: s.rating,
        notes: s.notes,
        createdAt: daysAgo(8),
      },
    });
  }

  const counts = {
    users: await db.user.count(),
    jobs: await db.job.count(),
    candidates: await db.candidate.count(),
    applications: await db.application.count(),
    evaluations: await db.evaluation.count(),
    scorecards: await db.scorecard.count(),
    activity: await db.activityLog.count(),
  };
  console.log("Seed complete:", counts);
  console.log("Demo login: demo@resumerank.app / demo1234");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
