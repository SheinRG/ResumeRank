"use client";

import { Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  restoreApplicationAction,
  softDeleteApplicationAction,
} from "@/server/actions/applications";
import { getSelfIdLinkAction } from "@/server/actions/compliance";

export function ApplicationMenu({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      const result = await softDeleteApplicationAction(applicationId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      toast.success("Application removed.", {
        action: {
          label: "Undo",
          onClick: () => {
            void restoreApplicationAction(applicationId).then((restored) => {
              if (!restored.ok) {
                toast.error(restored.error);
                return;
              }
              router.refresh();
              toast.success("Application restored.");
            });
          },
        },
      });
    });
  }

  function handleCopySelfIdLink() {
    startTransition(async () => {
      const result = await getSelfIdLinkAction(applicationId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data.url);
        toast.success("Self-identification link copied. Send it to the candidate; answering is optional.");
      } catch {
        toast.message("Copy this link and send it to the candidate:", { description: result.data.url });
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={isPending}
          aria-label="More actions"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleCopySelfIdLink}>
          <Link2 aria-hidden="true" />
          Copy self-identification link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleRemove}>
          <Trash2 aria-hidden="true" />
          Remove from pipeline
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
