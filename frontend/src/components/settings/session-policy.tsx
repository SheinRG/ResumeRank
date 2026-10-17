"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { setSessionPolicyAction } from "@/server/actions/sessions";
import type { SessionPolicy } from "@/server/queries/sessions";
import { sessionPolicySchema } from "@resumerank/core/validators/session";

const HOUR = 60;
const DAY = 24 * HOUR;

const LIFETIME_PRESETS = [HOUR, 8 * HOUR, 12 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
const IDLE_PRESETS = [15, 30, HOUR, 4 * HOUR, 8 * HOUR, DAY, 3 * DAY, 7 * DAY, 30 * DAY];

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function formatMinutes(minutes: number): string {
  if (minutes % DAY === 0) return plural(minutes / DAY, "day");
  if (minutes % HOUR === 0) return plural(minutes / HOUR, "hour");
  return plural(minutes, "minute");
}

/** The presets, plus the saved value if it was set to something off the list. */
function optionsWith(presets: number[], current: number): number[] {
  return presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
}

function DurationSelect({
  id,
  label,
  value,
  presets,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  presets: number[];
  disabled: boolean;
  error: string | undefined;
  onChange: (minutes: number) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="w-full sm:w-48"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {optionsWith(presets, value).map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {formatMinutes(minutes)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SessionPolicyCard({ policy, canChange }: { policy: SessionPolicy; canChange: boolean }) {
  const [lifetimeMinutes, setLifetime] = useState(policy.lifetimeMinutes);
  const [idleMinutes, setIdle] = useState(policy.idleMinutes);
  const [errors, setErrors] = useState<Partial<Record<keyof SessionPolicy, string>>>({});
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();

  const dirty = lifetimeMinutes !== policy.lifetimeMinutes || idleMinutes !== policy.idleMinutes;

  function save() {
    const parsed = sessionPolicySchema.safeParse({ lifetimeMinutes, idleMinutes });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setErrors({ lifetimeMinutes: fields.lifetimeMinutes?.[0], idleMinutes: fields.idleMinutes?.[0] });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await withStepUp(() => setSessionPolicyAction(parsed.data));
      if (!result.ok) {
        setErrors({
          lifetimeMinutes: result.fieldErrors?.lifetimeMinutes?.[0],
          idleMinutes: result.fieldErrors?.idleMinutes?.[0],
        });
        toast.error(result.error);
        return;
      }
      toast.success("Session limits saved. They apply to every session from its next request.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session limits</CardTitle>
        <CardDescription>
          How long anyone in the workspace stays signed in, SSO sessions included. A change applies
          to existing sessions too: anyone past a new limit, you included, signs in again on their
          next request.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-6 sm:flex-row">
          <DurationSelect
            id="session-lifetime"
            label="Sign in again after"
            value={lifetimeMinutes}
            presets={LIFETIME_PRESETS}
            disabled={!canChange || isPending}
            error={errors.lifetimeMinutes}
            onChange={setLifetime}
          />
          <DurationSelect
            id="session-idle"
            label="Sign out after inactivity of"
            value={idleMinutes}
            presets={IDLE_PRESETS}
            disabled={!canChange || isPending}
            error={errors.idleMinutes}
            onChange={setIdle}
          />
        </div>
        {canChange ? (
          <div>
            <Button type="button" onClick={save} disabled={!dirty || isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isPending ? "Saving…" : "Save limits"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
        )}
      </CardContent>
    </Card>
  );
}
