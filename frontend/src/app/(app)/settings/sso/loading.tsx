import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SsoLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-3 md:grid-cols-2">
            {["acs", "entity", "redirect"].map((key) => (
              <div key={key} className="flex flex-col gap-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-9 w-36" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-6">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </CardContent>
      </Card>
    </div>
  );
}
