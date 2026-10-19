import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const STAT_KEYS = ["members", "jobs", "candidates", "applications"];
const FACT_KEYS = ["plan", "seats", "past-due", "period", "customer", "security", "domains", "failed", "support"];
const ROW_KEYS = ["row-1", "row-2", "row-3", "row-4"];

export default function StaffCompanyLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading workspace">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <Card key={key} className="rounded-2xl py-6">
            <CardContent className="flex flex-col gap-2 px-6">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-14" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FACT_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {ROW_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-4">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
