import { Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { FILLED_STAR_CLASS, STAR_POSITIONS } from "./stars";

export function StarDisplay({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {STAR_POSITIONS.map((position) => (
        <Star
          key={position}
          aria-hidden="true"
          className={cn(
            "size-4",
            position <= rating ? FILLED_STAR_CLASS : "text-border",
          )}
        />
      ))}
    </span>
  );
}
