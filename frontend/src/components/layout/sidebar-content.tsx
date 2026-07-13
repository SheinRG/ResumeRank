import Link from "next/link";

import type { CurrentUser } from "@/lib/auth/guards";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export function SidebarContent({
  user,
  onNavigate,
}: {
  user: CurrentUser;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-6 py-6">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="px-6 text-lg font-semibold tracking-tight text-foreground"
      >
        ResumeRank
      </Link>
      <SidebarNav onNavigate={onNavigate} />
      <div className="mt-auto px-3">
        <UserMenu user={user} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
