"use client";

import { Loader2 } from "lucide-react";
import { useTransition, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { confirmRecentAuthAction } from "@/server/actions/step-up";
import { useStepUp } from "@/components/step-up/step-up-provider";

/**
 * A download link for a sensitive export. It confirms a recent sign-in first
 * (through the step-up dialog if needed), then lets the browser fetch the
 * file, which streams it to disk instead of holding it in the page.
 */
export function StepUpDownload({
  href,
  icon,
  children,
  size,
  beforeDownload,
}: {
  href: string;
  /** Shown before the label, and swapped for a spinner while confirming. */
  icon: ReactNode;
  children: ReactNode;
  size?: ComponentProps<typeof Button>["size"];
  /** Return false to stop, e.g. when the form behind the link is invalid. */
  beforeDownload?: () => boolean;
}) {
  const withStepUp = useStepUp();
  const [isPending, startTransition] = useTransition();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (beforeDownload && !beforeDownload()) return;
    startTransition(async () => {
      const result = await withStepUp(() => confirmRecentAuthAction());
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.assign(href);
    });
  }

  return (
    <Button asChild variant="outline" size={size}>
      <a href={href} download onClick={handleClick} aria-disabled={isPending || undefined}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
        {children}
      </a>
    </Button>
  );
}
