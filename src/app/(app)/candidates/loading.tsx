import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_KEYS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6", "row-7", "row-8"];

export default function CandidatesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Skeleton className="h-9 flex-1 sm:max-w-xs" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-36" />
          </div>
          <div className="flex flex-col gap-3">
            {ROW_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
