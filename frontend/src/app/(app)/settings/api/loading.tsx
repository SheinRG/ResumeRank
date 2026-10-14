import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CHECKBOX_KEYS = ["a", "b", "c", "d", "e", "f"];

export default function ApiSettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHECKBOX_KEYS.map((key) => (
              <Skeleton key={key} className="h-9 w-48" />
            ))}
          </div>
          <Skeleton className="h-10 w-28 rounded-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </CardContent>
      </Card>
    </div>
  );
}
