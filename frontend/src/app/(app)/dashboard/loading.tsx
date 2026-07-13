import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STAT_KEYS = ["stat-1", "stat-2", "stat-3", "stat-4"];
const CHART_KEYS = ["chart-1", "chart-2", "chart-3"];
const ROW_KEYS = ["row-1", "row-2", "row-3", "row-4", "row-5"];

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <Card key={key} className="py-5">
            <CardContent className="flex flex-col gap-2 px-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CHART_KEYS.map((key, index) => (
          <Card key={key} className={index === 2 ? "lg:col-span-2" : undefined}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {ROW_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
