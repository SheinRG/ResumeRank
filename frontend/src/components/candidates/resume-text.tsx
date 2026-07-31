"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLLAPSE_THRESHOLD = 1_200;

export function ResumeText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(text.length <= COLLAPSE_THRESHOLD);
  const collapsible = text.length > COLLAPSE_THRESHOLD;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "max-w-prose overflow-hidden whitespace-pre-wrap text-sm leading-relaxed text-foreground",
          !expanded && "max-h-72",
        )}
      >
        {text}
      </div>
      {collapsible ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show full resume"}
        </Button>
      ) : null}
    </div>
  );
}
