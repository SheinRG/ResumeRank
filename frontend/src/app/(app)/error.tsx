"use client";

import { ErrorState } from "@/components/shared/error-state";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <ErrorState
        title="Something went wrong"
        message={error.message || "An unexpected error occurred. Try again."}
        onRetry={reset}
      />
    </div>
  );
}
