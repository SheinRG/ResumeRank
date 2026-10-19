"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/staff", label: "Workspaces", exact: false },
  { href: "/staff/audit", label: "Staff audit log", exact: true },
];

function isActive(pathname: string, href: string, exact: boolean): boolean {
  if (exact) return pathname === href;
  return (pathname === href || pathname.startsWith(`${href}/companies`)) && pathname !== "/staff/audit";
}

export function StaffNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Staff console" className="flex items-center gap-1">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-white/10 text-brand-cream" : "text-brand-cream/70 hover:text-brand-cream",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
