import type { Prisma } from "../generated/prisma/client";
import type { Stage } from "../validators/enums";

interface ApplicationSnapshot {
  id: string;
  jobId: string;
  candidateId: string;
  stage: Stage;
  aiScore: number | null;
  createdAt: Date;
}

/** The application as webhook receivers see it: the same fields as `GET /api/v1/applications/{id}`'s top level. */
export function applicationEventData(
  application: ApplicationSnapshot,
  extra: Prisma.InputJsonObject = {},
): Prisma.InputJsonObject {
  return {
    application: {
      id: application.id,
      jobId: application.jobId,
      candidateId: application.candidateId,
      stage: application.stage,
      aiScore: application.aiScore,
      createdAt: application.createdAt.toISOString(),
    },
    ...extra,
  };
}
