import { db } from "@resumerank/core/db";
import { requireUser } from "@/lib/auth/guards";
import { STAGES, type Stage } from "@resumerank/core/validators/enums";

const RECENT_ACTIVITY_LIMIT = 8;
const SCORE_BUCKET_WIDTH = 10;
const SCORE_BUCKET_COUNT = 10;
const HISTORY_WEEKS = 8;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STAGES: readonly Stage[] = STAGES.filter(
  (stage) => stage !== "HIRED" && stage !== "REJECTED",
);

export interface DashboardStats {
  openJobs: number;
  totalCandidates: number;
  activeApplications: number;
  averageScore: number | null;
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
  actor: { id: string; name: string; image: string | null };
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

function bucketByWeek(dates: Date[], weekStarts: Date[]): WeekPoint[] {
  return weekStarts.map((weekStart, index) => {
    const nextStart =
      index + 1 < weekStarts.length
        ? weekStarts[index + 1]
        : new Date(weekStart.getTime() + MS_PER_WEEK);
    const count = dates.filter((d) => d >= weekStart && d < nextStart).length;
    return { weekStart, count };
  });
}

function bucketScores(scores: number[]): ScoreBucket[] {
  const buckets = Array.from({ length: SCORE_BUCKET_COUNT }, (_, i) => {
    const lower = i * SCORE_BUCKET_WIDTH;
    const upper = i === SCORE_BUCKET_COUNT - 1 ? 100 : lower + SCORE_BUCKET_WIDTH - 1;
    return { bucket: `${lower}–${upper}`, count: 0 };
  });
  for (const score of scores) {
    const index = Math.min(SCORE_BUCKET_COUNT - 1, Math.floor(score / SCORE_BUCKET_WIDTH));
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export async function getDashboardData(): Promise<DashboardData> {
  await requireUser();

  const weekStarts = lastNWeekStarts(HISTORY_WEEKS);
  const earliestWeekStart = weekStarts[0];

  const [
    openJobs,
    totalCandidates,
    activeApplications,
    scoreAggregate,
    stageGroups,
    scoredApplications,
    recentInRange,
    recentActivity,
  ] = await Promise.all([
    db.job.count({ where: { status: "OPEN" } }),
    db.candidate.count(),
    db.application.count({
      where: { deletedAt: null, stage: { in: [...ACTIVE_STAGES] } },
    }),
    db.application.aggregate({
      where: { deletedAt: null, aiScore: { not: null } },
      _avg: { aiScore: true },
    }),
    db.application.groupBy({
      by: ["stage"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.application.findMany({
      where: { deletedAt: null, aiScore: { not: null } },
      select: { aiScore: true },
    }),
    db.application.findMany({
      where: { deletedAt: null, createdAt: { gte: earliestWeekStart } },
      select: { createdAt: true },
    }),
    db.activityLog.findMany({
      take: RECENT_ACTIVITY_LIMIT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { actor: { select: { id: true, name: true, image: true } } },
    }),
  ]);

  const countByStage = new Map(
    stageGroups.map((g): [Stage, number] => [g.stage, g._count._all]),
  );
  const funnel: FunnelStagePoint[] = STAGES.map((stage) => ({
    stage,
    count: countByStage.get(stage) ?? 0,
  }));

  const scoreDistribution = bucketScores(
    scoredApplications
      .map((a) => a.aiScore)
      .filter((score): score is number => score !== null),
  );

  const applicationsOverTime = bucketByWeek(
    recentInRange.map((a) => a.createdAt),
    weekStarts,
  );

  return {
    stats: {
      openJobs,
      totalCandidates,
      activeApplications,
      averageScore:
        scoreAggregate._avg.aiScore == null ? null : Math.round(scoreAggregate._avg.aiScore),
    },
    funnel,
    scoreDistribution,
    applicationsOverTime,
    recentActivity,
  };
}
