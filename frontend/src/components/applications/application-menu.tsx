"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  restoreApplicationAction,
  softDeleteApplicationAction,
} from "@/server/actions/applications";

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
        <DropdownMenuItem variant="destructive" onSelect={handleRemove}>
          <Trash2 aria-hidden="true" />
          Remove from pipeline
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
