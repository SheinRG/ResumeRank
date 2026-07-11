import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
};

function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2">
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export { ErrorState };
