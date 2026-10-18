import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { currentScoringSettings } from "../../src/scoring/engine";
import { OPTED_OUT_MESSAGE, NOTICE_REQUIRED_MESSAGE } from "../../src/scoring/policy";
import { claimNextRun, processRun, type Evaluator } from "../../src/scoring/queue";
import { createApplication, getApplication, updateStage } from "../../src/services/applications";
import { createCandidate } from "../../src/services/candidates";
import { setCandidateAiFlags, updateAiPolicy } from "../../src/services/compliance";
import { listStageDecisions } from "../../src/services/decisions";
import { DomainError, NotFoundError } from "../../src/services/errors";
import { getImpactReport, getSelfIdLinkToken, getSelfIdInvite, submitSelfId } from "../../src/services/fairness";
import { requestJobScoring, requestScoring } from "../../src/services/scoring";
import { candidateCreateSchema } from "../../src/validators/candidate";
import { aiPolicySchema } from "../../src/validators/compliance";
import { createTenant, destroyTenant, RESUME_TEXT, type TenantFixture } from "./fixtures";

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("compliance-a"), createTenant("compliance-b")]);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await db.$disconnect();
});

beforeEach(async () => {
  await db.rateLimitCounter.deleteMany({
    where: { OR: [{ key: { contains: a.owner.actorId } }, { key: { contains: a.companyId } }] },
  });
  await db.scoringRun.deleteMany({ where: { companyId: a.companyId, status: { in: ["QUEUED", "RUNNING"] } } });
  await db.company.update({
    where: { id: a.companyId },
    data: { aiRedactPii: false, aiNoticeRequired: false, aiNoticeText: null },
  });
});

const recordingEvaluator = (): { evaluate: Evaluator; seen: string[] } => {
  const seen: string[] = [];
  const evaluate: Evaluator = async (job, resumeText) => {
    seen.push(resumeText);
    return {
      result: {
        summary: "Strong.",
        evaluations: job.requirements.map((r) => ({
          requirementId: r.id,
          verdict: "STRONG" as const,
          modelVerdict: "STRONG" as const,
          evidence: "TypeScript",
          evidenceStatus: "VERIFIED" as const,
          note: "Fake note.",
        })),
      },
      model: currentScoringSettings().model,
      attempts: 1,
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 1,
      rawOutput: "{}",
      injectionSignals: [],
    };
  };
  return { evaluate, seen };
};

async function addApplicant(name = `Dana Okafor ${randomUUID().slice(0, 4)}`) {
  const tag = randomUUID().slice(0, 8);
  const candidate = await createCandidate(
    a.owner,
    candidateCreateSchema.parse({
      name,
      email: `dana-${tag}@example.test`,
      source: "MANUAL",
      resumeText: `${name}\ndana-${tag}@example.test · +1 415 555 0134\n${RESUME_TEXT}`,
    }),
  );
  const application = await createApplication(a.owner, { jobId: a.jobId, candidateId: candidate.id });
  return { candidateId: candidate.id, applicationId: application.id, name };
}

async function scoreNow(evaluate: Evaluator) {
  const claim = await claimNextRun();
  if (!claim) throw new Error("expected a queued run");
  await processRun(claim, evaluate);
  return db.scoringRun.findUniqueOrThrow({ where: { id: claim.id } });
}

describe("finished scoring records", () => {
  it("can't be changed or deleted by any role, the owner included", async () => {
    await expect(
      db.scoringRun.update({ where: { id: a.scoringRunId }, data: { aiScore: 100 } }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(db.evaluation.updateMany({ where: { scoringRunId: a.scoringRunId }, data: { note: "Rewritten" } })).rejects.toThrow(
      /cannot be changed/,
    );
    await expect(db.scoringRun.delete({ where: { id: a.scoringRunId } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.evaluation.deleteMany({ where: { scoringRunId: a.scoringRunId } })).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("still go when their application's candidate is erased", async () => {
    const { applicationId, candidateId } = await addApplicant();
    await requestScoring(a.owner, applicationId);
    const run = await scoreNow(recordingEvaluator().evaluate);
    expect(run.status).toBe("SUCCEEDED");

    await db.candidate.delete({ where: { id: candidateId } });
    expect(await db.scoringRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await db.evaluation.count({ where: { scoringRunId: run.id } })).toBe(0);
  });

  it("keep exactly what the model was given", async () => {
    const { applicationId } = await addApplicant();
    await requestScoring(a.owner, applicationId);
    const run = await scoreNow(recordingEvaluator().evaluate);
    expect(run.redacted).toBe(false);
    expect(run.input).toMatchObject({ resume: expect.stringContaining(RESUME_TEXT) });
  });
});

describe("hiding personal details from the AI", () => {
  it("redacts the resume before the model sees it, and records that it did", async () => {
    await updateAiPolicy(a.owner, aiPolicySchema.parse({ aiRedactPii: true, aiNoticeRequired: false, aiNoticeText: "" }));
    const { applicationId, name } = await addApplicant();
    await requestScoring(a.owner, applicationId);
    const { evaluate, seen } = recordingEvaluator();
    const run = await scoreNow(evaluate);

    expect(seen[0]).not.toContain(name);
    expect(seen[0]).not.toMatch(/@example\.test|555/);
    expect(seen[0]).toContain("[NAME]");
    expect(seen[0]).toContain(RESUME_TEXT);
    expect(run).toMatchObject({ status: "SUCCEEDED", redacted: true });
    expect(JSON.stringify(run.input)).not.toContain(name);
  });
});

describe("the AI notice and opt-out", () => {
  it("refuses to score a candidate who opted out, singly and in bulk", async () => {
    const { applicationId, candidateId } = await addApplicant();
    await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: false, optedOut: true });

    await expect(requestScoring(a.owner, applicationId)).rejects.toThrow(OPTED_OUT_MESSAGE);
    const bulk = await requestJobScoring(a.owner, a.jobId);
    expect(bulk.excluded).toBeGreaterThanOrEqual(1);
    expect(await db.scoringRun.count({ where: { applicationId } })).toBe(0);
  });

  it("fails a queued run when the candidate opts out before it's scored", async () => {
    const { applicationId, candidateId } = await addApplicant();
    await requestScoring(a.owner, applicationId);
    await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: false, optedOut: true });
    const { evaluate, seen } = recordingEvaluator();
    const run = await scoreNow(evaluate);

    expect(seen).toEqual([]);
    expect(run).toMatchObject({ status: "FAILED", error: OPTED_OUT_MESSAGE });
  });

  it("requires the notice first when the workspace says so", async () => {
    await updateAiPolicy(a.owner, aiPolicySchema.parse({ aiRedactPii: false, aiNoticeRequired: true, aiNoticeText: "" }));
    const { applicationId, candidateId } = await addApplicant();
    await expect(requestScoring(a.owner, applicationId)).rejects.toThrow(NOTICE_REQUIRED_MESSAGE);

    const flags = await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: true, optedOut: false });
    expect(flags.aiNoticeAt).toBeInstanceOf(Date);
    await expect(requestScoring(a.owner, applicationId)).resolves.toMatchObject({ outcome: "queued" });
  });

  it("keeps the original date when a flag is saved again", async () => {
    const { candidateId } = await addApplicant();
    const first = await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: true, optedOut: false });
    const again = await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: true, optedOut: false });
    expect(again.aiNoticeAt).toEqual(first.aiNoticeAt);
  });

  it("treats another company's candidate as missing", async () => {
    await expect(
      setCandidateAiFlags(b.owner, { id: a.candidateId, noticeGiven: true, optedOut: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("leaves activity entries free of the candidate's name", async () => {
    const { candidateId, name } = await addApplicant();
    await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: true, optedOut: true });
    const entries = await db.activityLog.findMany({ where: { companyId: a.companyId, entityId: candidateId } });
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["candidate.ai_notice", "candidate.ai_opt_out"]),
    );
    for (const entry of entries.filter((e) => e.action.startsWith("candidate.ai_"))) {
      expect(entry.summary).not.toContain(name);
    }
  });
});

describe("the decision record", () => {
  it("records the AI output the decider saw with each stage change", async () => {
    const { applicationId } = await addApplicant();
    await updateStage(a.owner, { id: applicationId, stage: "SCREENING" });
    await requestScoring(a.owner, applicationId);
    const run = await scoreNow(recordingEvaluator().evaluate);
    await updateStage(a.owner, { id: applicationId, stage: "SHORTLISTED" });

    const detail = await getApplication(a.owner, applicationId);
    expect(detail?.decisions.map((decision) => [decision.from, decision.to, decision.ai.kind])).toEqual([
      ["NEW", "SCREENING", "unscored"],
      ["SCREENING", "SHORTLISTED", "shown"],
    ]);
    expect(detail?.decisions[1]?.ai).toMatchObject({ scoringRunId: run.id, score: run.aiScore });
  });

  it("hides the score from roles that can't see scores", async () => {
    const { applicationId } = await addApplicant();
    await requestScoring(a.owner, applicationId);
    await scoreNow(recordingEvaluator().evaluate);
    await updateStage(a.owner, { id: applicationId, stage: "INTERVIEW" });

    // The application page checks the interviewer's access before it reads the record.
    const asInterviewer = await listStageDecisions({ ...a.owner, role: "INTERVIEWER" }, applicationId);
    expect(asInterviewer).toHaveLength(1);
    expect(asInterviewer[0]?.ai).toEqual({ kind: "hidden" });
  });
});

describe("voluntary self-identification", () => {
  it("accepts answers only through an intact link, and replaces them on a second answer", async () => {
    const { applicationId } = await addApplicant();
    const token = await getSelfIdLinkToken(a.owner, applicationId);

    expect(await getSelfIdInvite(`${token}x`)).toBeNull();
    expect(await getSelfIdInvite(`${a.applicationId}.${token.split(".")[1]}`)).toBeNull();
    await expect(submitSelfId({ token: `${token}x`, sex: "FEMALE", race: "ASIAN" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await submitSelfId({ token, sex: "FEMALE", race: "ASIAN" });
    await submitSelfId({ token, sex: "DECLINED", race: "ASIAN" });
    const stored = await db.selfIdResponse.findUniqueOrThrow({ where: { applicationId } });
    expect(stored).toMatchObject({ companyId: a.companyId, sex: null, race: "ASIAN" });
    expect(await getSelfIdInvite(token)).toMatchObject({ answered: true });

    const audit = await db.activityLog.findFirstOrThrow({
      where: { companyId: a.companyId, action: "application.self_id", entityId: applicationId },
    });
    expect(JSON.stringify([audit.summary, audit.metadata])).not.toMatch(/ASIAN|FEMALE/);
  });

  it("won't issue a link for another company's application", async () => {
    await expect(getSelfIdLinkToken(b.owner, a.applicationId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports answers only in aggregate, to admins, within the company", async () => {
    const { applicationId } = await addApplicant();
    await submitSelfId({ token: await getSelfIdLinkToken(a.owner, applicationId), sex: "MALE", race: "WHITE" });

    const report = await getImpactReport(a.owner, {});
    expect(report.sex.rows.find((row) => row.category === "MALE")?.applicants).toBeGreaterThanOrEqual(1);
    const other = await getImpactReport(b.owner, {});
    expect(other.sex.rows.find((row) => row.category === "MALE")).toBeUndefined();
    await expect(getImpactReport({ ...a.owner, role: "MEMBER" }, {})).rejects.toThrow();
    await expect(getImpactReport(b.owner, { jobId: a.jobId })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("domain errors", () => {
  it("are DomainErrors so adapters show the message", async () => {
    const { applicationId, candidateId } = await addApplicant();
    await setCandidateAiFlags(a.owner, { id: candidateId, noticeGiven: false, optedOut: true });
    await expect(requestScoring(a.owner, applicationId)).rejects.toBeInstanceOf(DomainError);
  });
});
