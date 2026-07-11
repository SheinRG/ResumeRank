import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_KEYS = ["row-1", "row-2", "row-3", "row-4", "row-5"];

export default function TeamLoading() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ROW_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
