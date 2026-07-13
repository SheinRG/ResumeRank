import type { CurrentUser } from "@/lib/auth/guards";
import { CommandPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";

export function TopBar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <MobileNav user={user} />
      <span className="text-base font-semibold tracking-tight text-foreground md:hidden">
        ResumeRank
      </span>
      <div className="ml-auto flex items-center gap-2">
        <CommandPalette />
      </div>
    </header>
  );
}
