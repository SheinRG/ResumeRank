"use client";

import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

function codesText(codes: string[]): string {
  return [
    "ResumeRank two-factor recovery codes",
    "Each code works once. Keep them somewhere safe, apart from your password.",
    "",
    ...codes,
    "",
  ].join("\n");
}

/** Shown exactly once, right after the codes are generated; only their hashes are stored. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codesText(codes));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Download the codes instead.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([codesText(codes)], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "resumerank-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-verdict-partial/40 bg-verdict-partial/10 p-3 text-sm text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-verdict-partial" aria-hidden="true" />
        Save these recovery codes now — they won&apos;t be shown again. Each one signs you in once if
        you lose your phone or passkey.
      </p>
      <ol className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="font-mono text-sm tracking-wide text-foreground">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden="true" />
          Download
        </Button>
        <Button type="button" onClick={onDone} className="sm:ml-auto">
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}
