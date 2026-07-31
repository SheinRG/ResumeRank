"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  group: "center" | "right";
  home?: boolean;
};

// One flat list so a single sliding indicator can travel across both the
// centred links and the right-hand actions. The "home" item (Get started) is
// where the lime pill rests when nothing is hovered.
const ITEMS: NavItem[] = [
  { label: "How it works", href: "#how-it-works", group: "center" },
  { label: "Why ResumeRank", href: "#why", group: "center" },
  { label: "FAQ", href: "#faq", group: "center" },
  { label: "Sign in", href: "/login", group: "right" },
  { label: "Get started free", href: "/register", group: "right", home: true },
];
const HOME_INDEX = ITEMS.findIndex((item) => item.home);
const MOBILE_LINKS = ITEMS.filter((item) => item.group === "center");

type Rect = { x: number; y: number; w: number; h: number };

export function SiteNav() {
  const [open, setOpen] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [target, setTarget] = useState(HOME_INDEX);
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback((index: number) => {
    const el = itemRefs.current[index];
    if (!el) return;
    setRect({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    measure(target);
  }, [target, measure]);

  // Widths shift once the web fonts load and on resize — keep the pill aligned.
  useEffect(() => {
    const remeasure = () => measure(target);
    window.addEventListener("resize", remeasure);
    document.fonts?.ready.then(remeasure).catch(() => {});
    return () => window.removeEventListener("resize", remeasure);
  }, [target, measure]);

  const linkClass = (item: NavItem, index: number) =>
    cn(
      "relative z-10 inline-flex items-center rounded-full text-sm transition-colors duration-300",
      item.home ? "border border-brand-lime px-[18px] py-2.5 font-semibold" : "px-4 py-2 font-medium",
      target === index
        ? "text-brand-night"
        : item.home
          ? "text-brand-lime"
          : "text-brand-muted",
    );

  return (
    <header className="fixed inset-x-0 top-0 z-[60] border-b border-white/[0.07] bg-brand-night/70 backdrop-blur-xl">
      <div
        ref={rowRef}
        onMouseLeave={() => setTarget(HOME_INDEX)}
        className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 rounded-full bg-brand-lime transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
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

        <Link href="/" className="relative z-10 flex items-center gap-2.5">
          <span className="flex size-[26px] items-center justify-center rounded-[7px] bg-brand-lime font-display text-sm font-bold text-brand-night">
            R
          </span>
          <span className="font-display text-[17px] font-semibold tracking-tight text-brand-cream">
            ResumeRank
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1.5 md:flex">
          {ITEMS.map((item, i) =>
            item.group === "center" ? (
              <a
                key={item.href}
                href={item.href}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onMouseEnter={() => setTarget(i)}
                onFocus={() => setTarget(i)}
                className={linkClass(item, i)}
              >
                {item.label}
              </a>
            ) : null,
          )}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {ITEMS.map((item, i) =>
            item.group === "right" ? (
              <Link
                key={item.href}
                href={item.href}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onMouseEnter={() => setTarget(i)}
                onFocus={() => setTarget(i)}
                className={linkClass(item, i)}
              >
                {item.label}
              </Link>
            ) : null,
          )}
        </div>

        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="relative z-10 flex size-10 items-center justify-center rounded-full text-brand-cream transition-colors hover:bg-white/10"
            >
              <Menu className="size-5" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent
              side="right"
              className="border-white/10 bg-brand-night text-brand-cream"
            >
              <SheetHeader>
                <SheetTitle className="font-display text-brand-cream">
                  ResumeRank
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="Primary" className="flex flex-col gap-1 px-4">
                {MOBILE_LINKS.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <a
                      href={link.href}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-brand-muted hover:bg-white/5 hover:text-brand-cream"
                    >
                      {link.label}
                    </a>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-auto flex flex-col gap-2 p-4">
                <SheetClose asChild>
                  <Link
                    href="/login"
                    className="rounded-full border border-white/15 px-4 py-2.5 text-center text-sm font-medium text-brand-cream"
                  >
                    Sign in
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link
                    href="/register"
                    className="rounded-full bg-brand-lime px-4 py-2.5 text-center text-sm font-semibold text-brand-night"
                  >
                    Get started free
                  </Link>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
