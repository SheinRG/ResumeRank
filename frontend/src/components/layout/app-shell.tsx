"use client";

import { useState, type ReactNode } from "react";

import type { CurrentUser } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

export function AppShell({
  user,
  children,
}: {
  user: CurrentUser;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const toggle = () => setCollapsed((prev) => !prev);

  return (
    <>
      <AppSidebar user={user} collapsed={collapsed} onToggle={toggle} />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding-left] duration-300 ease-[cubic-bezier(.22,1,.36,1)]",
          collapsed ? "md:pl-[76px]" : "md:pl-60",
        )}
      >
        <TopBar user={user} />
        {children}
      </div>
    </>
  );
}
