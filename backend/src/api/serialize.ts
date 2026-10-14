import type { Application, Candidate } from "../generated/prisma/client";
import type { ApplicationDetail, ApplicationListItem } from "../services/applications";
import type { CandidateDetail, CandidateListItem } from "../services/candidates";
import type { JobDetail, JobListItem } from "../services/jobs";
import type { ScoringRequestResult } from "../services/scoring";
import type { Paged } from "../types/paged";

/**
 * The public API's response shapes. Each picks fields from the service
 * result explicitly, so a column added for the app (or an internal one like
 * a raw model output) never reaches an integration by accident, and the
 * contract changes only when this file does.
 */

export interface ApiList<T> {
  data: T[];
  /** Pass as `after` to fetch the next page; null on the last one. */
  nextCursor: string | null;
  total: number;
  totalCapped: boolean;
}

export function apiList<S, T>(page: Paged<S>, map: (item: S) => T): ApiList<T> {
  return {
    data: page.items.map(map),
    nextCursor: page.nextCursor,
    total: page.total,
    totalCapped: page.totalCapped,
  };
}

export function jobSummary(job: JobListItem) {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    location: job.location,
    employmentType: job.employmentType,
    applicationCount: job.applicationCount,
    createdAt: job.createdAt,
  };
}

export function jobDetail(job: JobDetail) {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    status: job.status,
    location: job.location,
    employmentType: job.employmentType,
    department: job.department,
    requirements: job.requirements.map((r) => ({ id: r.id, label: r.label, weight: r.weight })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function candidateSummary(candidate: CandidateListItem) {
  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    headline: candidate.headline,
    source: candidate.source,
    applicationCount: candidate.applicationCount,
    createdAt: candidate.createdAt,
  };
}

type CandidateFields = Pick<
  Candidate,
  "id" | "name" | "email" | "headline" | "source" | "resumeText" | "createdAt" | "updatedAt"
>;

export function candidateRecord(candidate: CandidateFields) {
  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    headline: candidate.headline,
    source: candidate.source,
    resumeText: candidate.resumeText,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

export function candidateDetail(candidate: CandidateDetail) {
  return {
    ...candidateRecord(candidate),
    applications: candidate.applications.map((a) => ({
      id: a.id,
      jobId: a.job.id,
      stage: a.stage,
      aiScore: a.aiScore,
      createdAt: a.createdAt,
    })),
  };
}

/** A created or moved application, before any of its detail is loaded. */
export function applicationRecord(application: Application) {
  return {
    id: application.id,
    jobId: application.jobId,
    candidateId: application.candidateId,
    stage: application.stage,
    aiScore: application.aiScore,
    scoredAt: application.scoredAt,
    createdAt: application.createdAt,
  };
}

export function applicationSummary(jobId: string, application: ApplicationListItem) {
  return {
    id: application.id,
    jobId,
    candidateId: application.candidate.id,
    candidate: { name: application.candidate.name, email: application.candidate.email },
    stage: application.stage,
    aiScore: application.aiScore,
    scoredAt: application.scoredAt,
    createdAt: application.createdAt,
  };
}

/**
 * Scores and evidence are empty for a key whose creator's role can't see
 * them: the service leaves them out, the same as on the page.
 */
export function applicationDetail(application: ApplicationDetail) {
  return {
    id: application.id,
    jobId: application.job.id,
    candidateId: application.candidate.id,
    stage: application.stage,
    aiScore: application.aiScore,
    aiSummary: application.aiSummary,
    scoredAt: application.scoredAt,
    evaluations: application.evaluations.map((e) => ({
      requirementId: e.requirementId,
      criterion: e.criterion,
      weight: e.weight,
      verdict: e.verdict,
      evidence: e.evidence,
      note: e.note,
    })),
    createdAt: application.createdAt,
  };
}

export function scoringRequest(result: ScoringRequestResult) {
  return {
    outcome: result.outcome,
    run: {
      id: result.run.id,
      status: result.run.status,
      aiScore: result.run.aiScore,
      error: result.run.error,
      createdAt: result.run.createdAt,
      finishedAt: result.run.finishedAt,
    },
  };
}
