"use client";

import { Eye, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { useFormat } from "@/components/format/format-provider";
import { Button } from "@/components/ui/button";
import type { CurrentUser, SupportSessionView } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/roles";
import { endSupportSessionAction } from "@/server/actions/staff";

/**
 * Always on screen while staff view a workspace as one of its members, so
 * it's never mistaken for their own account, and one click from the way out.
 */
export function SupportSessionBanner({ user, session }: { user: CurrentUser; session: SupportSessionView }) {
  const router = useRouter();
  const format = useFormat();
  const [isPending, startTransition] = useTransition();

  function end() {
    startTransition(async () => {
      const result = await endSupportSessionAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Support session ended.");
      router.push(result.data.companyId ? `/staff/companies/${result.data.companyId}` : "/staff");
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-x-4 gap-y-2 bg-brand-lime px-4 py-2.5 text-sm text-brand-night sm:px-6"
    >
      <Eye className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Support session, read-only.</span> Viewing{" "}
        {user.companyName ?? "this workspace"} as {user.name} ({ROLE_LABELS[user.role]}) until{" "}
        <time dateTime={new Date(session.expiresAt).toISOString()}>{format.dateTime(session.expiresAt)}</time>.
      </p>
      <Button
        type="button"
        size="sm"
        onClick={end}
        disabled={isPending}
        className="bg-brand-night text-brand-cream hover:bg-brand-night/90"
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
        End session
      </Button>
    </div>
  );
}
