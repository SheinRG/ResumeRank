"use client";

import { ErrorState } from "@/components/shared/error-state";

/** Like the app's boundary: never the raw message, only the digest that matches the server log. */
export default function StaffError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const reference = error.digest ? ` Reference: ${error.digest}.` : "";
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <ErrorState
        title="Something went wrong"
        message={`The staff console couldn't load this page. Try again; the reference finds it in the server log.${reference}`}
        onRetry={unstable_retry}
      />
    </div>
  );
}
