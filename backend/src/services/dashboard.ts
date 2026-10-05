import { tenantDb } from "../tenant-db";
import { STAGES, type Stage } from "../validators/enums";
import type { TenantContext } from "./context";
import {
  activityActorInclude,
  toActivityActor,
  type ActivityActor,
} from "./activity";

const RECENT_ACTIVITY_LIMIT = 8;
const SCORE_BUCKET_WIDTH = 10;
const SCORE_BUCKET_COUNT = 10;
const HISTORY_WEEKS = 8;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = MS_PER_WEEK;
const ACTIVE_STAGES: readonly Stage[] = STAGES.filter(
  (stage) => stage !== "HIRED" && stage !== "REJECTED",
);

export interface DashboardStats {
  openJobs: number;
  totalJobs: number;
  totalCandidates: number;
  newCandidates: number;
  activeApplications: number;
  averageScore: number | null;
  scoredApplications: number;
}

export interface FunnelStagePoint {
  stage: Stage;
  count: number;
}

export interface ScoreBucket {
  bucket: string;
  count: number;
}

export interface WeekPoint {
  weekStart: Date;
  count: number;
}

export interface ActivityFeedItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: Date;
  actor: ActivityActor;
}

export interface DashboardData {
  stats: DashboardStats;
  funnel: FunnelStagePoint[];
  scoreDistribution: ScoreBucket[];
  applicationsOverTime: WeekPoint[];
  recentActivity: ActivityFeedItem[];
}

function startOfIsoWeek(date: Date): Date {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + mondayOffset);
  return utc;
}

function lastNWeekStarts(n: number): Date[] {
  const currentWeekStart = startOfIsoWeek(new Date());
  const starts: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    starts.push(new Date(currentWeekStart.getTime() - i * MS_PER_WEEK));
  }
  return starts;
}

// Human label for score-histogram bucket `index` (0-based). Counts are filled
// from a SQL GROUP BY so the full (unbounded) scored set never enters memory.
function scoreBucketLabel(index: number): string {
  const lower = index * SCORE_BUCKET_WIDTH;
  const upper = index === SCORE_BUCKET_COUNT - 1 ? 100 : lower + SCORE_BUCKET_WIDTH - 1;
  return `${lower}–${upper}`;
}

export async function getDashboardData(ctx: TenantContext): Promise<DashboardData> {
  const { companyId } = ctx;

  const weekStarts = lastNWeekStarts(HISTORY_WEEKS);
  const earliestWeekStart = weekStarts[0];
  const recentSince = new Date(Date.now() - RECENT_WINDOW_MS);

  const [
    openJobs,
    totalJobs,
    totalCandidates,
    newCandidates,
    activeApplications,
    scoreAggregate,
    stageGroups,
    scoreBucketRows,
    weekRows,
    recentActivityRows,
  ] = await Promise.all([
    tenantDb(ctx).job.count({ where: { companyId, status: "OPEN" } }),
    tenantDb(ctx).job.count({ where: { companyId } }),
    tenantDb(ctx).candidate.count({ where: { companyId } }),
    tenantDb(ctx).candidate.count({ where: { companyId, createdAt: { gte: recentSince } } }),
    tenantDb(ctx).application.count({
      where: { companyId, deletedAt: null, stage: { in: [...ACTIVE_STAGES] } },
    }),
    tenantDb(ctx).application.aggregate({
      where: { companyId, deletedAt: null, aiScore: { not: null } },
      _avg: { aiScore: true },
      _count: { aiScore: true },
    }),
    tenantDb(ctx).application.groupBy({
      by: ["stage"],
      where: { companyId, deletedAt: null },
      _count: { _all: true },
    }),
    tenantDb(ctx).$queryRaw<Array<{ bucket: number; count: number }>>`
      SELECT LEAST(${SCORE_BUCKET_COUNT}, floor("aiScore"::numeric / ${SCORE_BUCKET_WIDTH}) + 1)::int AS bucket,
             count(*)::int AS count
      FROM "Application"
      WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL AND "aiScore" IS NOT NULL
      GROUP BY bucket
    `,
    // date_trunc('week') is the ISO (Monday) week, matching startOfIsoWeek;
    // timestamps are stored as UTC, so both sides bucket in UTC.
    tenantDb(ctx).$queryRaw<Array<{ weekStart: Date; count: number }>>`
      SELECT date_trunc('week', "createdAt") AS "weekStart", count(*)::int AS count
      FROM "Application"
      WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL AND "createdAt" >= ${earliestWeekStart}
      GROUP BY 1
    `,
    tenantDb(ctx).activityLog.findMany({
      where: { companyId },
      take: RECENT_ACTIVITY_LIMIT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: activityActorInclude,
    }),
  ]);
  const recentActivity: ActivityFeedItem[] = recentActivityRows.map((row) => ({
    ...row,
    actor: toActivityActor(row.actor),
  }));

  const countByStage = new Map(
    stageGroups.map((g): [Stage, number] => [g.stage, g._count._all]),
  );
  const funnel: FunnelStagePoint[] = STAGES.map((stage) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
  }));

  const countByBucket = new Map(scoreBucketRows.map((r) => [r.bucket, r.count]));
  const scoreDistribution: ScoreBucket[] = Array.from(
    { length: SCORE_BUCKET_COUNT },
    (_, i) => ({ bucket: scoreBucketLabel(i), count: countByBucket.get(i + 1) ?? 0 }),
  );

  const countByWeek = new Map(weekRows.map((r) => [r.weekStart.getTime(), r.count]));
  const applicationsOverTime: WeekPoint[] = weekStarts.map((weekStart) => ({
    weekStart,
    count: countByWeek.get(weekStart.getTime()) ?? 0,
  }));

  return {
    stats: {
      openJobs,
      totalJobs,
      totalCandidates,
      newCandidates,
      activeApplications,
      averageScore:
        scoreAggregate._avg.aiScore == null ? null : Math.round(scoreAggregate._avg.aiScore),
      scoredApplications: scoreAggregate._count.aiScore,
    },
    funnel,
    scoreDistribution,
    applicationsOverTime,
    recentActivity,
  };
}
