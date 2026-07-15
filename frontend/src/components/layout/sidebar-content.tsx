import Link from "next/link";

import type { CurrentUser } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export function SidebarContent({
  user,
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  user: CurrentUser;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const mark = (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-brand-lime font-display-app text-[15px] font-semibold text-brand-night">
      R
    </span>
  );
  const wordmark = (
    <span className="font-display-app text-[17px] font-medium tracking-[0.01em]">
      ResumeRank
    </span>
  );

  return (
    <div className="flex h-full flex-col gap-6 bg-brand-night py-6 text-brand-cream">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex items-center gap-2.5 rounded-lg transition-colors hover:bg-white/5",
            collapsed ? "mx-auto size-10 justify-center" : "mx-6 py-1",
          )}
        >
          {mark}
          {!collapsed ? wordmark : null}
        </button>
      ) : (
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 px-6"
        >
          {mark}
          {wordmark}
        </Link>
      )}

      <div className="flex flex-col gap-2.5">
        {!collapsed ? (
          <span className="px-6 font-mono text-[10px] tracking-[0.1em] text-white/30">
            WORKSPACE
          </span>
        ) : null}
        <SidebarNav onNavigate={onNavigate} collapsed={collapsed} />
      </div>

      <div className={cn("mt-auto", collapsed ? "px-2" : "px-3")}>
        <UserMenu user={user} onNavigate={onNavigate} collapsed={collapsed} />
      </div>
    </div>
  );
}
