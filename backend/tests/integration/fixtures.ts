import { randomUUID } from "node:crypto";

import { db } from "../../src/db";
import { createCompanyInvite } from "../../src/auth/tokens";
import type { TenantContext } from "../../src/services/context";
import { createApplication } from "../../src/services/applications";
import { createCandidate } from "../../src/services/candidates";
import { createJob } from "../../src/services/jobs";
import { upsertScorecard } from "../../src/services/scorecards";
import { scorecardSchema } from "../../src/validators/application";
import { candidateCreateSchema } from "../../src/validators/candidate";
import { jobCreateSchema } from "../../src/validators/job";

export const RESUME_TEXT =
  "Senior backend engineer with eight years of TypeScript and Node.js experience. " +
  "Designed multi-tenant Postgres schemas, led a migration to row-level security, and " +
  "owned the hiring pipeline service end to end, including observability and on-call.";

export interface TenantFixture {
  companyId: string;
  owner: TenantContext;
  viewer: TenantContext;
  memberId: string;
  jobId: string;
  candidateId: string;
  candidateEmail: string;
  applicationId: string;
  inviteId: string;
  userIds: string[];
}

/**
 * A complete workspace — owner, member, viewer, job, candidate, application,
 * scorecard, invite and the activity they log — built through the real
 * services so the create paths run under the tenant-scoped client too. The
 * random tag keeps fixtures from colliding across runs on a shared database.
 */
export async function createTenant(label: string): Promise<TenantFixture> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const company = await db.company.create({ data: { name: `Company ${tag}`, slug: tag } });

  const [owner, member, viewer] = await Promise.all(
    (["OWNER", "MEMBER", "VIEWER"] as const).map((role) =>
      db.user.create({
        data: {
          name: `${role.toLowerCase()} ${tag}`,
          email: `${role.toLowerCase()}-${tag}@example.test`,
          role,
          companyId: company.id,
        },
      }),
    ),
  );
  const ownerCtx: TenantContext = { companyId: company.id, actorId: owner.id, role: "OWNER" };

  const job = await createJob(
    ownerCtx,
    jobCreateSchema.parse({
      title: `Backend Engineer ${tag}`,
      description: "Own the services that power multi-tenant resume screening.",
      employmentType: "FULL_TIME",
      status: "OPEN",
      requirements: [
        { label: "TypeScript in production", weight: "MUST" },
        { label: "Postgres schema design", weight: "NICE" },
      ],
    }),
  );
  const candidateEmail = `candidate-${tag}@example.test`;
  const candidate = await createCandidate(
    ownerCtx,
    candidateCreateSchema.parse({
      name: `Candidate ${tag}`,
      email: candidateEmail,
      source: "MANUAL",
      resumeText: RESUME_TEXT,
    }),
  );
  const application = await createApplication(ownerCtx, {
    jobId: job.id,
    candidateId: candidate.id,
  });
  await upsertScorecard(
    ownerCtx,
    scorecardSchema.parse({ applicationId: application.id, rating: 4 }),
  );
  const { invite } = await createCompanyInvite({
    companyId: company.id,
    email: `invitee-${tag}@example.test`,
    role: "MEMBER",
    invitedById: owner.id,
  });

  return {
    companyId: company.id,
    owner: ownerCtx,
    viewer: { companyId: company.id, actorId: viewer.id, role: "VIEWER" },
    memberId: member.id,
    jobId: job.id,
    candidateId: candidate.id,
    candidateEmail,
    applicationId: application.id,
    inviteId: invite.id,
    userIds: [owner.id, member.id, viewer.id],
  };
}

/** Company deletion cascades its jobs, candidates, applications, invites and log; users go last. */
export async function destroyTenant(fixture: TenantFixture): Promise<void> {
  await db.company.deleteMany({ where: { id: fixture.companyId } });
  await db.user.deleteMany({ where: { id: { in: fixture.userIds } } });
}

export async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}
