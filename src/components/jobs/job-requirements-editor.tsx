"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RequirementWeight } from "@/lib/validators/enums";
import { REQUIREMENT_WEIGHT_LABELS } from "@/components/jobs/labels";

export interface RequirementRow {
  /** Client-only key so React can track rows before they have a server id. */
  clientId: string;
  id?: string;
  label: string;
  weight: RequirementWeight;
}

const WEIGHT_OPTIONS: RequirementWeight[] = ["MUST", "NICE"];

export function JobRequirementsEditor({
  rows,
  onChange,
  errors,
  listError,
}: {
  rows: RequirementRow[];
  onChange: (rows: RequirementRow[]) => void;
  errors: Record<string, string[]>;
  listError?: string;
}) {
  const labelRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  // Set by addRow; the callback ref focuses the new row's input once it mounts.
  const pendingFocusId = useRef<string | null>(null);

  function updateRow(clientId: string, patch: Partial<RequirementRow>) {
    onChange(rows.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)));
  }

  function removeRow(clientId: string) {
    onChange(rows.filter((row) => row.clientId !== clientId));
  }

  function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    onChange(next);
  }

  function addRow() {
    const clientId =
      typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `req-${Date.now()}`;
    onChange([...rows, { clientId, label: "", weight: "MUST" }]);
    pendingFocusId.current = clientId;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const rowErrors = errors[row.clientId];
          return (
            <div
              key={row.clientId}
              className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-start sm:gap-2"
            >
              <div className="flex flex-1 flex-col gap-1">
                <Input
                  ref={(el) => {
                    labelRefs.current.set(row.clientId, el);
                    if (el && pendingFocusId.current === row.clientId) {
                      pendingFocusId.current = null;
                      el.focus();
                    }
                  }}
                  value={row.label}
                  onChange={(event) => updateRow(row.clientId, { label: event.target.value })}
                  placeholder="e.g. 3+ years of React experience"
                  aria-label={`Requirement ${index + 1} label`}
                  aria-invalid={rowErrors ? true : undefined}
                />
                {rowErrors?.map((message) => (
                  <p key={message} className="text-xs font-medium text-destructive">
                    {message}
                  </p>
                ))}
              </div>
              <div
                role="radiogroup"
                aria-label={`Requirement ${index + 1} priority`}
                className="flex shrink-0 items-center gap-1 rounded-md border border-input bg-background p-0.5"
              >
                {WEIGHT_OPTIONS.map((weight) => (
                  <button
                    key={weight}
                    type="button"
                    role="radio"
                    aria-checked={row.weight === weight}
                    onClick={() => updateRow(row.clientId, { weight })}
                    className={cn(
                      "min-h-8 rounded-sm px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                      row.weight === weight
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {REQUIREMENT_WEIGHT_LABELS[weight]}
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  disabled={index === 0}
                  onClick={() => moveRow(index, -1)}
                  aria-label={`Move requirement ${index + 1} up`}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  disabled={index === rows.length - 1}
                  onClick={() => moveRow(index, 1)}
                  aria-label={`Move requirement ${index + 1} down`}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  onClick={() => removeRow(row.clientId)}
                  aria-label={`Remove requirement ${index + 1}`}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {listError ? <p className="text-xs font-medium text-destructive">{listError}</p> : null}

      <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-fit">
        <Plus aria-hidden="true" />
        Add requirement
      </Button>
    </div>
  );
}
