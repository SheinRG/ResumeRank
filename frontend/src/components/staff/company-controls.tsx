"use client";

import { Ban, Gauge, RotateCcw, ToggleLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useFormat } from "@/components/format/format-provider";
import { FormField } from "@/components/shared/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { staffSetAiBudgetAction, staffSetFlagAction, staffSetSuspensionAction } from "@/server/actions/staff";
import type { FeatureFlag } from "@resumerank/core/flags/registry";
import { actionError } from "@resumerank/core/types/action";
import { aiBudgetOverrideSchema, staffFlagOverrideSchema, suspensionSchema } from "@resumerank/core/validators/staff";
import { ReasonDialog } from "./reason-dialog";

const INVALID = "Check the highlighted fields.";

export function SuspensionCard({
  companyId,
  companyName,
  suspendedAt,
  canChange,
}: {
  companyId: string;
  companyName: string;
  suspendedAt: Date | null;
  canChange: boolean;
}) {
  const router = useRouter();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const suspend = suspendedAt === null;

  return (
    <Card className={suspendedAt ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle>Suspension</CardTitle>
        <CardDescription>
          A suspended workspace can&apos;t be opened by anyone, owners included, and its API keys and
          directory sync are refused. Nothing is deleted, and lifting the suspension restores
          everything. The workspace&apos;s activity log records both.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {suspendedAt ? (
          <Badge variant="destructive">Suspended {format.dateTime(suspendedAt)}</Badge>
        ) : (
          <Badge variant="outline">Active</Badge>
        )}
        {canChange ? (
          <Button
            type="button"
            variant={suspend ? "destructive" : "outline"}
            size="sm"
            onClick={() => setOpen(true)}
          >
            {suspend ? <Ban aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            {suspend ? "Suspend workspace" : "Lift suspension"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only staff admins can suspend a workspace.</p>
        )}
      </CardContent>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={suspend ? `Suspend ${companyName}` : `Lift ${companyName}'s suspension`}
        description={
          suspend
            ? "Everyone in it is moved out at their next request, and its API keys stop working at once."
            : "Members can open it again at their next request, and its API keys work again."
        }
        confirmLabel={suspend ? "Suspend" : "Lift suspension"}
        destructive={suspend}
        onConfirm={async (reason) => {
          const parsed = suspensionSchema.safeParse({ companyId, suspended: suspend, reason });
          if (!parsed.success) return actionError<never>(INVALID, parsed.error.flatten().fieldErrors);
          return staffSetSuspensionAction(parsed.data);
        }}
        onDone={(state) => {
          toast.success(state.suspendedAt ? `${companyName} is suspended.` : `${companyName} is active again.`);
          router.refresh();
        }}
      />
    </Card>
  );
}

export function AiBudgetCard({
  companyId,
  used,
  budget,
  override,
  canChange,
}: {
  companyId: string;
  used: number;
  budget: number;
  /** The workspace's own budget, or null while it follows its plan. */
  override: number | null;
  canChange: boolean;
}) {
  const router = useRouter();
  const format = useFormat();
  const [open, setOpen] = useState<"set" | "clear" | null>(null);
  const [value, setValue] = useState(String(override ?? budget));
  const [budgetErrors, setBudgetErrors] = useState<string[] | undefined>();

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI budget</CardTitle>
        <CardDescription>
          Tokens scoring may spend over any 30 days. A workspace budget replaces its plan&apos;s, for a
          trial extension or a one-off import; return it to the plan when that&apos;s done.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          <span className="font-mono">{format.number(used)}</span> of{" "}
          <span className="font-mono">{format.number(budget)}</span> tokens used in the last 30 days{" "}
          {override === null ? (
            <Badge variant="outline">Plan budget</Badge>
          ) : (
            <Badge variant="outline" className="border-brand-lime text-foreground">
              Set by staff
            </Badge>
          )}
        </p>
        {canChange ? (
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Budget in tokens" errors={budgetErrors} className="w-full sm:w-56">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </FormField>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen("set")}>
              <Gauge aria-hidden="true" />
              Set budget
            </Button>
            {override !== null ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen("clear")}>
                <RotateCcw aria-hidden="true" />
                Return to the plan&apos;s
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <ReasonDialog
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        title={open === "clear" ? "Return to the plan's budget" : "Set the AI budget"}
        description={
          open === "clear"
            ? "The workspace goes back to its plan's budget, or the deployment default while billing is off."
            : `Scoring stops once ${value ? format.number(Number(value)) : "this many"} tokens are used in any 30 days.`
        }
        confirmLabel={open === "clear" ? "Return to the plan's" : "Set budget"}
        onConfirm={async (reason) => {
          const parsed = aiBudgetOverrideSchema.safeParse({
            companyId,
            budget: open === "clear" ? null : value === "" ? Number.NaN : Number(value),
            reason,
          });
          if (!parsed.success) {
            const fieldErrors = parsed.error.flatten().fieldErrors;
            setBudgetErrors(fieldErrors.budget);
            return actionError<never>(fieldErrors.budget?.[0] ?? INVALID, fieldErrors);
          }
          setBudgetErrors(undefined);
          return staffSetAiBudgetAction(parsed.data);
        }}
        onDone={() => {
          toast.success("AI budget saved.");
          router.refresh();
        }}
      />
    </Card>
  );
}

export interface FlagRow {
  flag: FeatureFlag;
  label: string;
  enabled: boolean;
  source: "override" | "plan" | "rollout" | "default";
  reason: string | null;
}

const SOURCE_LABELS: Record<FlagRow["source"], string> = {
  override: "Staff override",
  plan: "Plan",
  rollout: "Rollout",
  default: "Default",
};

type OverrideChoice = "on" | "off" | "clear";

function isOverrideChoice(value: string): value is OverrideChoice {
  return value === "on" || value === "off" || value === "clear";
}

export function FlagsCard({ companyId, flags, canChange }: { companyId: string; flags: FlagRow[]; canChange: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<{ row: FlagRow; choice: OverrideChoice } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Features</CardTitle>
        <CardDescription>
          What the workspace gets and why. An override wins over the plan, rollout and default, and lands
          in the workspace&apos;s activity log; it&apos;s the same change as{" "}
          <code className="font-mono text-xs">npm run flags -- set</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Feature</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Decided by</TableHead>
              {canChange ? <TableHead className="text-right">Override</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map((row) => (
              <TableRow key={row.flag}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{row.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{row.flag}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={row.enabled ? "default" : "outline"}>{row.enabled ? "On" : "Off"}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {SOURCE_LABELS[row.source]}
                  {row.reason ? <span className="block text-xs">{row.reason}</span> : null}
                </TableCell>
                {canChange ? (
                  <TableCell className="text-right">
                    <Select
                      value=""
                      onValueChange={(choice) => {
                        if (isOverrideChoice(choice)) setPending({ row, choice });
                      }}
                    >
                      <SelectTrigger size="sm" className="ml-auto w-36" aria-label={`Override ${row.label}`}>
                        <ToggleLeft aria-hidden="true" />
                        <SelectValue placeholder="Change…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">Turn on</SelectItem>
                        <SelectItem value="off">Turn off</SelectItem>
                        {row.source === "override" ? <SelectItem value="clear">Clear override</SelectItem> : null}
                      </SelectContent>
                    </Select>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <ReasonDialog
        open={pending !== null}
        onOpenChange={(next) => !next && setPending(null)}
        title={
          pending
            ? pending.choice === "clear"
              ? `Clear the ${pending.row.label} override`
              : `Turn ${pending.choice} ${pending.row.label}`
            : "Change a feature"
        }
        description="Takes effect on the workspace's next request. Turning a feature off never removes what it set up, so the workspace can still switch it off itself."
        confirmLabel="Save override"
        onConfirm={async (reason) => {
          if (!pending) return actionError<never>(INVALID);
          const parsed = staffFlagOverrideSchema.safeParse({
            companyId,
            flag: pending.row.flag,
            enabled: pending.choice === "clear" ? null : pending.choice === "on",
            reason,
          });
          if (!parsed.success) return actionError<never>(INVALID, parsed.error.flatten().fieldErrors);
          return staffSetFlagAction(parsed.data);
        }}
        onDone={(change) => {
          toast.success(change.changed ? "Override saved." : "Nothing changed: it was already like that.");
          router.refresh();
        }}
      />
    </Card>
  );
}
