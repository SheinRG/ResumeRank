import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const EVALUATION_KEYS = ["eval-1", "eval-2", "eval-3", "eval-4"];

export default function ApplicationLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="size-10" />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Skeleton className="size-32 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-4 w-full max-w-prose" />
            <Skeleton className="h-4 w-4/5 max-w-prose" />
          </div>
          <Skeleton className="h-10 w-32 shrink-0" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {EVALUATION_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-36" />
        </CardContent>
      </Card>
    </div>
  );
}
