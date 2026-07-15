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

const COLLAPSE_TRANSITION_MS = 320;

export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const activeIndex = NAV_ITEMS.findIndex((item) => isActive(pathname, item.href));
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tracking, setTracking] = useState(false);

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
  }, [activeIndex, measure]);

  useEffect(() => {
    const onResize = () => measure(activeIndexRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  useEffect(() => {
    // The sidebar's width animates over ~300ms on collapse/expand, and the
    // item boxes resize continuously along with it (icon-only vs full-width).
    // Sample every frame for the duration instead of measuring once at the
    // end, otherwise the highlight sits still and then jumps at the last
    // moment instead of gliding with the rail.
    let frameId: number;
    const start = performance.now();
    const tick = (now: number) => {
      setTracking(true);
      measure(activeIndexRef.current);
      if (now - start < COLLAPSE_TRANSITION_MS) {
        frameId = requestAnimationFrame(tick);
      } else {
        setTracking(false);
      }
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [collapsed, measure]);

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className={cn("relative flex flex-col gap-1", collapsed ? "items-center px-2" : "px-3")}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 left-0 rounded-xl bg-brand-lime",
          tracking
            ? "transition-opacity duration-150"
            : "transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)]",
        )}
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
