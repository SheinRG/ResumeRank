import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

const STAR_POSITIONS = [1, 2, 3, 4, 5] as const;

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
            position <= rating
              ? "fill-amber-400 text-amber-400 dark:fill-amber-500 dark:text-amber-500"
              : "text-border",
          )}
        />
      ))}
    </span>
  );
}
