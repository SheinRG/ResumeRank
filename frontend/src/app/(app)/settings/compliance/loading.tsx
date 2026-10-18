import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SWITCH_KEYS = ["redact", "notice"];
const ROW_KEYS = ["a", "b", "c"];

export default function ComplianceLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading compliance settings">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {SWITCH_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-6">
              <div className="flex w-full max-w-xl flex-col gap-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-full" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <Skeleton className="h-9 w-72 rounded-lg" />
            <Skeleton className="h-10 w-36 rounded-full" />
          </div>
          {ROW_KEYS.map((key) => (
            <Skeleton key={key} className="h-10 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
