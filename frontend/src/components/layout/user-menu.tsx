"use client";

import Link from "next/link";
import { LogOut, User as UserIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { initials } from "@/lib/format";
import { logoutAction } from "@/server/actions/auth";
import type { CurrentUser } from "@/lib/auth/guards";

const ROLE_LABELS: Record<CurrentUser["role"], string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export function UserMenu({
  user,
  onNavigate,
}: {
  user: CurrentUser;
  onNavigate?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full items-center justify-start gap-3 rounded-xl border-t border-white/[0.07] px-2 py-2.5 text-left text-brand-cream hover:bg-white/5 hover:text-brand-cream"
        >
          <Avatar className="size-[34px]">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="bg-brand-lime/15 text-xs font-semibold text-brand-lime">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-brand-cream">
              {user.name}
            </span>
            <span className="truncate text-[11px] text-brand-muted">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onClick={onNavigate}>
          <Link href="/settings">
            <UserIcon aria-hidden="true" />
            Profile
          </Link>
        </DropdownMenuItem>
        <div className="flex items-center justify-between px-2 py-1.5 text-sm text-foreground">
          <span>Theme</span>
          <ThemeToggle />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" asChild>
          <form action={logoutAction} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2 text-left">
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
