"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { setPasswordPolicyAction } from "@/server/actions/password-policy";
import type { PasswordPolicy } from "@/server/queries/password-policy";
import { passwordPolicySchema } from "@resumerank/core/validators/password-policy";

const LENGTH_PRESETS = [8, 10, 12, 14, 16, 20, 24];

/** The presets, plus the saved value if it was set to something off the list. */
function lengthOptions(current: number): number[] {
  return LENGTH_PRESETS.includes(current) ? LENGTH_PRESETS : [...LENGTH_PRESETS, current].sort((a, b) => a - b);
}

export function PasswordPolicyCard({ policy, canChange }: { policy: PasswordPolicy; canChange: boolean }) {
  const [minLength, setMinLength] = useState(policy.minLength);
  const [breachCheck, setBreachCheck] = useState(policy.breachCheck);
  const [saved, setSaved] = useState(policy);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();

  const dirty = minLength !== saved.minLength || breachCheck !== saved.breachCheck;

  function save() {
    const parsed = passwordPolicySchema.safeParse({ minLength, breachCheck });
    if (!parsed.success) {
      setError(parsed.error.flatten().fieldErrors.minLength?.[0] ?? "Check the policy.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await withStepUp(() => setPasswordPolicyAction(parsed.data));
      if (!result.ok) {
        setError(result.fieldErrors?.minLength?.[0] ?? null);
        toast.error(result.error);
        return;
      }
      setSaved(result.data);
      toast.success("Password policy saved. Passwords that fall short are changed at their next sign-in.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password policy</CardTitle>
        <CardDescription>
          What a password must meet to sign in to this workspace. It applies to new passwords at once,
          and to existing ones at their next password sign-in, which asks for a new password if the
          old one falls short. Someone in several workspaces meets the strictest of their policies.
          Single sign-on and Google sign-ins aren&apos;t affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password-min-length">Minimum length</Label>
          <Select
            value={String(minLength)}
            onValueChange={(next) => setMinLength(Number(next))}
            disabled={!canChange || isPending}
          >
            <SelectTrigger
              id="password-min-length"
              className="w-full sm:w-48"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "password-min-length-error" : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lengthOptions(minLength).map((length) => (
                <SelectItem key={length} value={String(length)}>
                  {length} characters
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error ? (
            <p id="password-min-length-error" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="password-breach-check">Refuse breached passwords</Label>
            <p className="text-sm text-muted-foreground">
              Checked against Have I Been Pwned without sending the password: only the first five
              characters of its hash leave ResumeRank. If the service can&apos;t be reached, the
              password is accepted.
            </p>
          </div>
          <Switch
            id="password-breach-check"
            checked={breachCheck}
            disabled={!canChange || isPending}
            onCheckedChange={setBreachCheck}
          />
        </div>

        {canChange ? (
          <div>
            <Button type="button" onClick={save} disabled={!dirty || isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isPending ? "Saving…" : "Save policy"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
        )}
      </CardContent>
    </Card>
  );
}
