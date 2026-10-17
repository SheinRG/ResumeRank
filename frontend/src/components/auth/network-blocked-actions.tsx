"use client";

import { ArrowRightLeft, Loader2, LogOut, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/actions/auth";
import { switchWorkspaceAction } from "@/server/actions/workspaces";

export function NetworkBlockedActions({
  workspaces,
}: {
  /** The user's other workspaces this network may open. */
  workspaces: { companyId: string; name: string }[];
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function open(companyId: string) {
    setSwitching(companyId);
    startTransition(async () => {
      const result = await switchWorkspaceAction({ companyId });
      if (!result.ok) {
        setSwitching(null);
        toast.error(result.error);
        return;
      }
      toast.success(`Switched to ${result.data.name}`);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Button asChild className="w-full">
        <Link href="/dashboard">
          <RefreshCw aria-hidden="true" />
          Try again
        </Link>
      </Button>

      {workspaces.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Or open another workspace you belong to:</p>
          <ul className="flex flex-col gap-2">
            {workspaces.map((workspace) => (
              <li key={workspace.companyId}>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={switching !== null}
                  onClick={() => open(workspace.companyId)}
                >
                  {switching === workspace.companyId ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRightLeft aria-hidden="true" />
                  )}
                  <span className="truncate">{workspace.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={logoutAction}>
        <Button type="submit" variant="ghost" className="-ml-3">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </div>
  );
}
