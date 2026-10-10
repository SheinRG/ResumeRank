"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** A value an admin pastes somewhere else (an IdP form, a DNS record), shown in full with a copy button. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          onClick={copy}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
