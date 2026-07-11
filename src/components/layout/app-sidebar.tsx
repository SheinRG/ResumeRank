import type { CurrentUser } from "@/lib/auth/guards";
import { SidebarContent } from "./sidebar-content";

export function AppSidebar({ user }: { user: CurrentUser }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card md:flex">
      <SidebarContent user={user} />
    </aside>
  );
}
