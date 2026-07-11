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
import { getDashboardData } from "@/server/queries/dashboard";
import { PipelineFunnelChart } from "@/components/dashboard/pipeline-funnel-chart";
import { ScoreDistributionChart } from "@/components/dashboard/score-distribution-chart";
import { ApplicationsOverTimeChart } from "@/components/dashboard/applications-over-time-chart";
import { ActivityFeed } from "@/components/dashboard/activity-feed";

export const metadata: Metadata = { title: "Dashboard · ResumeRank" };

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Your team's hiring pipeline at a glance."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open jobs" value={data.stats.openJobs} icon={Briefcase} />
        <StatCard label="Candidates" value={data.stats.totalCandidates} icon={Users} />
        <StatCard
          label="In pipeline"
          value={data.stats.activeApplications}
          icon={ClipboardList}
        />
        <StatCard
          label="Average score"
          value={data.stats.averageScore ?? "—"}
          icon={Star}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline funnel</CardTitle>
            <CardDescription>Applications by stage</CardDescription>
          </CardHeader>
          <CardContent>
            <PipelineFunnelChart data={data.funnel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Score distribution</CardTitle>
            <CardDescription>AI scores across scored applications</CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreDistributionChart data={data.scoreDistribution} />
          </CardContent>
        </Card>
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

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest changes across your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed items={data.recentActivity} />
        </CardContent>
      </Card>
    </div>
  );
}
