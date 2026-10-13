"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CurrentUser } from "@/lib/auth/guards";
import { initials } from "@/lib/format";
import { switchWorkspaceAction } from "@/server/actions/workspaces";
import { ROLE_LABELS } from "@/lib/roles";

function WorkspaceMark({ name, logoUrl, className }: { name: string; logoUrl: string | null; className: string }) {
  return (
    <Avatar className={className}>
      {logoUrl ? <AvatarImage src={logoUrl} alt="" className="object-cover" /> : null}
      <AvatarFallback className="rounded-[6px] bg-white/10 text-[9px] font-medium text-white/70">
        {initials(name) || "•"}
      </AvatarFallback>
    </Avatar>
  );
}

export function WorkspaceSwitcher({ user, onNavigate }: { user: CurrentUser; onNavigate?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const name = user.companyName ?? "Workspace";

  function open(companyId: string) {
    if (companyId === user.companyId) return;
    startTransition(async () => {
      const result = await switchWorkspaceAction({ companyId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onNavigate?.();
      toast.success(`Switched to ${result.data.name}`);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Workspace: ${name}. Switch workspace`}
        className="mx-3 flex min-h-11 items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-white/5"
      >
        <WorkspaceMark name={name} logoUrl={user.companyLogoUrl} className="size-5 shrink-0 rounded-[6px]" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
          {name}
        </span>
        {isPending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-white/40" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-white/40" aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {user.workspaces.map((workspace) => {
          const current = workspace.companyId === user.companyId;
          return (
            <DropdownMenuItem
              key={workspace.companyId}
              disabled={isPending || !workspace.openable}
              onSelect={() => open(workspace.companyId)}
              className="gap-2.5"
            >
              <Avatar className="size-6 shrink-0 rounded-[6px]">
                {workspace.logoUrl ? (
                  <AvatarImage src={workspace.logoUrl} alt="" className="object-cover" />
                ) : null}
                <AvatarFallback className="rounded-[6px] bg-muted text-[10px] font-medium text-muted-foreground">
                  {initials(workspace.name) || "•"}
                </AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{workspace.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {workspace.openable ? ROLE_LABELS[workspace.role] : "Requires single sign-on"}
                </span>
              </span>
              {current ? <Check className="size-4 shrink-0 text-foreground" aria-label="Current workspace" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onClick={onNavigate}>
          <Link href="/onboarding">
            <Plus aria-hidden="true" />
            Add a workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
