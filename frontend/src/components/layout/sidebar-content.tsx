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
    <div className="flex h-full flex-col gap-6 bg-brand-night py-6 text-brand-cream">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-6"
      >
        <span className="flex size-7 items-center justify-center rounded-[9px] bg-brand-lime font-display-app text-[15px] font-semibold text-brand-night">
          R
        </span>
        <span className="font-display-app text-[17px] font-medium tracking-[0.01em]">
          ResumeRank
        </span>
      </Link>

      <div className="flex flex-col gap-2.5">
        <span className="px-6 font-mono text-[10px] tracking-[0.1em] text-white/30">
          WORKSPACE
        </span>
        <SidebarNav onNavigate={onNavigate} />
      </div>

      <div className="mt-auto px-3">
        <UserMenu user={user} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
