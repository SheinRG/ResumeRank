"use client";

import { ErrorState } from "@/components/shared/error-state";

import "./globals.css";

/**
 * Last-resort boundary for a failure in the root layout itself, so it renders
 * its own document. Like the app boundary it shows only the digest, which
 * matches the `request.error` log line, never the message.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const reference = error.digest ? ` Reference: ${error.digest}.` : "";
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center px-4">
        <title>Something went wrong · ResumeRank</title>
        <ErrorState
          className="w-full max-w-md"
          title="ResumeRank hit an unexpected error"
          message={`Try again, and if it keeps happening, contact support.${reference}`}
          onRetry={unstable_retry}
        />
      </body>
    </html>
  );
}
