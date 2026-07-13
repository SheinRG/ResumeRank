"use client";

import { ArchiveRestore, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { restoreApplicationAction } from "@/server/actions/applications";

export function RestoreBanner({
  applicationId,
  canRestore,
}: {
  applicationId: string;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreApplicationAction(applicationId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Application restored.");
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950"
    >
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
        This application was removed from the pipeline.
      </p>
      {canRestore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRestore}
          disabled={isPending}
          className="w-fit"
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ArchiveRestore aria-hidden="true" />
          )}
          {isPending ? "Restoring…" : "Restore"}
        </Button>
      ) : null}
    </div>
  );
}
