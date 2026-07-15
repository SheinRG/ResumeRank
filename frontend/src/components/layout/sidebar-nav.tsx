"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Rect = { x: number; y: number; w: number; h: number };

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const activeIndex = NAV_ITEMS.findIndex((item) => isActive(pathname, item.href));

  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback((index: number) => {
    const el = itemRefs.current[index];
    if (!el) {
      setRect(null);
      return;
    }
    setRect({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    measure(activeIndex);
  }, [activeIndex, measure, collapsed]);

  useEffect(() => {
    const onResize = () => measure(activeIndex);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeIndex, measure]);

  useEffect(() => {
    // Sidebar width animates over 300ms; re-measure once the collapse
    // transition settles so the highlight lands on the final item box.
    const timeout = setTimeout(() => measure(activeIndex), 300);
    return () => clearTimeout(timeout);
  }, [collapsed, activeIndex, measure]);

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className={cn("relative flex flex-col gap-1", collapsed ? "items-center px-2" : "px-3")}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-xl bg-brand-lime transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
        style={
          rect
            ? {
                transform: `translate(${rect.x}px, ${rect.y}px)`,
                width: rect.w,
                height: rect.h,
                opacity: 1,
              }
            : { opacity: 0 }
        }
      />
      {NAV_ITEMS.map((item, i) => {
        const active = i === activeIndex;
        const Icon = item.icon;
        const link = (
          <Link
            href={item.href}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative z-10 flex h-10 items-center rounded-xl text-sm transition-colors duration-300",
              collapsed ? "w-10 justify-center" : "w-full gap-3 px-3",
              active
                ? "font-semibold text-brand-night"
                : "font-medium text-brand-cream/65 hover:text-brand-cream",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {!collapsed ? item.label : null}
          </Link>
        );

        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            {collapsed ? <TooltipContent side="right">{item.label}</TooltipContent> : null}
          </Tooltip>
        );
      })}
    </nav>
  );
}
