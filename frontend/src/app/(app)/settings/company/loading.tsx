import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const FIELD_KEYS = ["name", "slug", "website", "industry", "size", "location", "description"];

export default function CompanyLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-xl" />
            <Skeleton className="h-9 flex-1 max-w-md" />
          </div>
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full max-w-md" />
            </div>
          ))}
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-4 w-56" />
        </CardContent>
      </Card>
    </div>
  );
}
