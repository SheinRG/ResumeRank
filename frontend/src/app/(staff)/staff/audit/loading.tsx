import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_KEYS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6", "row-7", "row-8"];

export default function StaffAuditLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading the staff audit log">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3">
          {ROW_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
