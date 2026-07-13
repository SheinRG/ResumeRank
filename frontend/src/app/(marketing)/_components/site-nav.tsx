"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#why", label: "Why ResumeRank" },
  { href: "#faq", label: "FAQ" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-[60] border-b border-white/[0.07] bg-brand-night/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-[26px] items-center justify-center rounded-[7px] bg-brand-lime font-display text-sm font-bold text-brand-night">
            R
          </span>
          <span className="font-display text-[17px] font-semibold tracking-tight text-brand-cream">
            ResumeRank
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-1.5 text-sm font-medium text-brand-muted md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 transition-colors hover:bg-brand-lime/10 hover:text-brand-lime"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="px-3.5 py-2 text-sm font-medium text-brand-muted transition-colors hover:text-brand-cream"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            data-magnetic
            className="inline-flex items-center gap-2 rounded-full bg-brand-lime px-[18px] py-2.5 text-sm font-semibold text-brand-night transition-transform hover:scale-[0.97]"
          >
            Get started free
          </Link>
        </div>

        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="flex size-10 items-center justify-center rounded-full text-brand-cream transition-colors hover:bg-white/10"
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
                {NAV_LINKS.map((link) => (
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
