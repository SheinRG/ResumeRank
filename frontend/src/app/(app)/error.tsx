"use client";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Never renders `error.message`: errors thrown on the client reach here
 * verbatim and can carry internals. The digest is safe to show and lets
 * support match the report to the server log entry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reference = error.digest ? ` Reference: ${error.digest}.` : "";
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <ErrorState
        title="Something went wrong"
        message={`We couldn't load this page. Try again, and if it keeps happening, contact support.${reference}`}
        onRetry={reset}
      />
    </div>
  );
}
