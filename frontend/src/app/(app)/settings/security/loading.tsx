import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SECTION_KEYS = ["app", "passkeys"];

export default function SecurityLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading security settings">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-5 w-12 rounded-md" />
          </div>
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {SECTION_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-10 w-56 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-6">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </CardContent>
      </Card>
    </div>
  );
}
