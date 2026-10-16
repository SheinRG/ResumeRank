import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PLAN_KEYS = ["plan-free", "plan-team", "plan-enterprise"];
const FEATURE_KEYS = ["feature-1", "feature-2", "feature-3"];

export default function BillingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-36" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {["seats", "tokens"].map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {PLAN_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-4 rounded-2xl border border-border p-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
              {FEATURE_KEYS.map((feature) => (
                <Skeleton key={feature} className="h-4 w-4/5" />
              ))}
              <Skeleton className="h-9 w-full rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
