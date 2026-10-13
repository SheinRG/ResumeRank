import type { Metadata } from "next";
import { Briefcase, ClipboardList, Star, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { can, requireMember } from "@/lib/auth/guards";
import { accessScope } from "@resumerank/core/auth/roles";
import { getDashboardData } from "@/server/queries/dashboard";
import { PipelineFunnelChart } from "@/components/dashboard/pipeline-funnel-chart";
import { ScoreDistributionChart } from "@/components/dashboard/score-distribution-chart";
import { ApplicationsOverTimeChart } from "@/components/dashboard/applications-over-time-chart";
import { ActivityFeed } from "@/components/dashboard/activity-feed";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [user, data] = await Promise.all([requireMember(), getDashboardData()]);
  const { stats } = data;
  const totalApplications = data.funnel.reduce((sum, point) => sum + point.count, 0);
  const showScores = can(user.role, "scoring.view");
  const showActivity = can(user.role, "activity.view");
  const wholeCompany = accessScope(user.role) === "company";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={
          wholeCompany
            ? "Your team's hiring pipeline at a glance."
            : "The pipeline for the jobs you're on, at a glance."
        }
      />

      <div
        className={cn(
          "grid grid-cols-1 gap-4 sm:grid-cols-2",
          showScores ? "lg:grid-cols-4" : "lg:grid-cols-3",
        )}
      >
        <StatCard
          label="Open jobs"
          value={stats.openJobs}
          delta={`${stats.totalJobs} total`}
          icon={Briefcase}
        />
        <StatCard
          label="Candidates"
          value={stats.totalCandidates}
          delta={
            stats.newCandidates > 0
              ? `+${stats.newCandidates} this week`
              : "no new this week"
          }
          deltaTone={stats.newCandidates > 0 ? "positive" : "neutral"}
          icon={Users}
        />
        <StatCard
          label="In pipeline"
          value={stats.activeApplications}
          delta={`${totalApplications} all-time`}
          icon={ClipboardList}
        />
        {showScores ? (
          <StatCard
            label="Average score"
            value={stats.averageScore ?? "—"}
            delta={
              stats.scoredApplications > 0
                ? `across ${stats.scoredApplications} scored`
                : "none scored yet"
            }
            icon={Star}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className={showScores ? undefined : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle>Pipeline funnel</CardTitle>
            <CardDescription>Applications by stage</CardDescription>
          </CardHeader>
          <CardContent>
            <PipelineFunnelChart data={data.funnel} />
          </CardContent>
        </Card>
        {showScores ? (
          <Card>
            <CardHeader>
              <CardTitle>Score distribution</CardTitle>
              <CardDescription>AI scores across scored applications</CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreDistributionChart
                data={data.scoreDistribution}
                averageScore={stats.averageScore}
              />
            </CardContent>
          </Card>
        ) : null}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Applications over time</CardTitle>
            <CardDescription>New applications, last 8 weeks</CardDescription>
          </CardHeader>
          <CardContent>
            <ApplicationsOverTimeChart data={data.applicationsOverTime} />
          </CardContent>
        </Card>
      </div>

      {showActivity ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest changes across your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={data.recentActivity} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
