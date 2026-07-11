"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";

import { ReportCardMock } from "./report-card-mock";

export function Hero() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:grid-cols-2 lg:items-center lg:pt-28">
      <FadeIn className="flex flex-col gap-6">
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
          Score every applicant against your actual requirements —{" "}
          <span className="text-primary">with evidence.</span>
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          Paste a resume, get a weighted score, and see exactly which
          requirements it met — quoted, verdict by verdict. No black box.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/register">
              Get started free
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="#how-it-works">See how it works</a>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.1} className="flex justify-center lg:justify-end">
        <ReportCardMock />
      </FadeIn>
    </div>
  );
}
