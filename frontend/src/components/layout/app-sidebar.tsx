import type { CurrentUser } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { SidebarContent } from "./sidebar-content";

export function AppSidebar({
  user,
  collapsed = false,
  onToggle,
}: {
  user: CurrentUser;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)] md:flex",
        collapsed ? "w-[76px]" : "w-60",
      )}
    >
      <SidebarContent user={user} collapsed={collapsed} onToggle={onToggle} />
    </aside>
  );
}
