import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_KEYS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6"];

export default function StaffSearchLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading workspaces">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-10 w-full rounded-lg sm:max-w-md" />
            <Skeleton className="h-10 w-28 rounded-full" />
          </div>
          <Skeleton className="h-4 w-64" />
          <div className="flex flex-col gap-3">
            {ROW_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="ml-auto h-4 w-10" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
