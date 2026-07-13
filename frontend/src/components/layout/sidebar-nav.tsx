"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Rect = { x: number; y: number; w: number; h: number };

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
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
  }, [activeIndex, measure]);

  useEffect(() => {
    const onResize = () => measure(activeIndex);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeIndex, measure]);

  return (
    <nav ref={navRef} aria-label="Primary" className="relative flex flex-col gap-1 px-3">
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
        return (
          <Link
            key={item.href}
            href={item.href}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative z-10 flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-300",
              active
                ? "font-semibold text-brand-night"
                : "font-medium text-brand-cream/65 hover:text-brand-cream",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
