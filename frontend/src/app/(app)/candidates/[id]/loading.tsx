import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const LINE_KEYS = ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6", "line-7", "line-8"];

export default function CandidateLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {LINE_KEYS.map((key) => (
              <Skeleton key={key} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {["app-1", "app-2", "app-3"].map((key) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
