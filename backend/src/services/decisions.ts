import { z } from "zod";

import { tenantDb } from "../tenant-db";
import { stageSchema, type Stage } from "../validators/enums";
import type { TenantContext } from "./context";
import { seesScores } from "./access";

/**
 * The human-oversight record (EU AI Act Art. 14, NYC LL144): every stage
 * change carries what the AI had told the person who made it. It lives in the
 * stage entry's metadata, so it's sealed into the tamper-evident audit chain
 * with the decision itself.
 */
export type DecisionAi =
  | { kind: "shown"; scoringRunId: string; score: number | null; scoredAt: string | null; model: string; promptVersion: string }
  /** The application had no score yet. */
  | { kind: "unscored" }
  /** The decider's role doesn't see AI scores. */
  | { kind: "hidden" }
  /** Recorded before decisions carried the AI context. */
  | { kind: "unrecorded" };

export interface StageDecision {
  id: string;
  at: Date;
  actor: { id: string; name: string } | null;
  from: Stage | null;
  to: Stage;
  ai: DecisionAi;
}

export interface DecisionRun {
  id: string;
  aiScore: number | null;
  finishedAt: Date | null;
  model: string;
  promptVersion: string;
}

/** What goes into the stage entry's metadata at the moment of the decision. */
export function decisionContext(ctx: TenantContext, run: DecisionRun | null): DecisionAi {
  if (!seesScores(ctx)) return { kind: "hidden" };
  if (!run) return { kind: "unscored" };
  return {
    kind: "shown",
    scoringRunId: run.id,
    score: run.aiScore,
    scoredAt: run.finishedAt?.toISOString() ?? null,
    model: run.model,
    promptVersion: run.promptVersion,
  };
}

const decisionAiSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("shown"),
    scoringRunId: z.string(),
    score: z.number().nullable(),
    scoredAt: z.string().nullable(),
    model: z.string(),
    promptVersion: z.string(),
  }),
  z.object({ kind: z.literal("unscored") }),
  z.object({ kind: z.literal("hidden") }),
]);

const stageMetadataSchema = z.object({
  from: stageSchema.nullish(),
  to: stageSchema,
  ai: decisionAiSchema.optional(),
});

const DECISION_LIMIT = 100;

/**
 * Oldest first, so the record reads as the application's history. Only for an
 * application the caller may already read (getApplication checks access first).
 */
export async function listStageDecisions(ctx: TenantContext, applicationId: string): Promise<StageDecision[]> {
  const entries = await tenantDb(ctx).activityLog.findMany({
    where: {
      companyId: ctx.companyId,
      entityType: "application",
      entityId: applicationId,
      action: "application.stage",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: DECISION_LIMIT,
    select: { id: true, createdAt: true, metadata: true, actor: { select: { id: true, name: true } } },
  });

  const showAi = seesScores(ctx);
  return entries.flatMap((entry) => {
    const parsed = stageMetadataSchema.safeParse(entry.metadata);
    if (!parsed.success) return [];
    const recorded = parsed.data.ai ?? { kind: "unrecorded" as const };
    return [
      {
        id: entry.id,
        at: entry.createdAt,
        actor: entry.actor,
        from: parsed.data.from ?? null,
        to: parsed.data.to,
        // Someone who can't see scores doesn't learn them from the record either.
        ai: showAi || recorded.kind !== "shown" ? recorded : { kind: "hidden" as const },
      },
    ];
  });
}
