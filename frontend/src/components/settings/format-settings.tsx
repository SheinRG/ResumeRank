"use client";

import { Loader2, LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createFormatters } from "@/lib/format";
import { updatePersonalFormatAction, updateWorkspaceFormatAction } from "@/server/actions/format";
import { SUPPORTED_LOCALES } from "@resumerank/core/locale";
import { personalFormatSchema, workspaceFormatSchema } from "@resumerank/core/validators/locale";

const FOLLOW_WORKSPACE = "workspace";
// A fixed instant, so the preview shows the same example on every visit.
const SAMPLE = new Date("2026-03-14T16:30:00Z");

function localeLabel(value: string): string {
  return SUPPORTED_LOCALES.find((locale) => locale.value === value)?.label ?? value;
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface FormatSettingsProps {
  timeZones: string[];
  workspace: { locale: string; timeZone: string };
}

type Props =
  | (FormatSettingsProps & { scope: "personal"; own: { locale: string | null; timeZone: string | null } })
  | (FormatSettingsProps & { scope: "workspace"; canEdit: boolean });

/**
 * Locale and time zone, for one person (each may follow the workspace
 * default) or for the workspace itself. The preview shows the result.
 */
export function FormatSettings(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const initial =
    props.scope === "personal"
      ? { locale: props.own.locale ?? FOLLOW_WORKSPACE, timeZone: props.own.timeZone ?? FOLLOW_WORKSPACE }
      : props.workspace;
  const [locale, setLocale] = useState(initial.locale);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const editable = props.scope === "personal" || props.canEdit;
  const dirty = locale !== saved.locale || timeZone !== saved.timeZone;

  const effective = {
    locale: locale === FOLLOW_WORKSPACE ? props.workspace.locale : locale,
    timeZone: timeZone === FOLLOW_WORKSPACE ? props.workspace.timeZone : timeZone,
  };
  const preview = createFormatters(effective);
  const zones = props.timeZones.includes(timeZone) || timeZone === FOLLOW_WORKSPACE ? props.timeZones : [timeZone, ...props.timeZones];

  function save() {
    const value = (choice: string) => (choice === FOLLOW_WORKSPACE ? null : choice);
    startTransition(async () => {
      let result;
      if (props.scope === "personal") {
        const parsed = personalFormatSchema.safeParse({ locale: value(locale), timeZone: value(timeZone) });
        if (!parsed.success) {
          setError("Choose a language and a time zone from the lists.");
          return;
        }
        result = await updatePersonalFormatAction(parsed.data);
      } else {
        const parsed = workspaceFormatSchema.safeParse({ locale, timeZone });
        if (!parsed.success) {
          setError("Choose a language and a time zone from the lists.");
          return;
        }
        result = await updateWorkspaceFormatAction(parsed.data);
      }
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setError(null);
      setSaved({ locale, timeZone });
      toast.success("Saved. Dates and numbers now use this format.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.scope === "personal" ? "Date and number format" : "Default format"}</CardTitle>
        <CardDescription>
          {props.scope === "personal"
            ? "How dates, times and numbers appear to you. Leave either on the workspace default to follow it."
            : "How dates, times and numbers appear to members who haven't chosen their own. The interface itself stays in English."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${props.scope}-locale`}>Language and region</Label>
            <Select value={locale} onValueChange={setLocale} disabled={!editable || isPending}>
              <SelectTrigger id={`${props.scope}-locale`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.scope === "personal" ? (
                  <SelectItem value={FOLLOW_WORKSPACE}>
                    Workspace default ({localeLabel(props.workspace.locale)})
                  </SelectItem>
                ) : null}
                {SUPPORTED_LOCALES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${props.scope}-time-zone`}>Time zone</Label>
            <Select value={timeZone} onValueChange={setTimeZone} disabled={!editable || isPending}>
              <SelectTrigger id={`${props.scope}-time-zone`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {props.scope === "personal" ? (
                  <SelectItem value={FOLLOW_WORKSPACE}>Workspace default ({props.workspace.timeZone})</SelectItem>
                ) : null}
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={isPending}
                onClick={() => setTimeZone(deviceTimeZone())}
              >
                <LocateFixed aria-hidden="true" />
                Use this device&apos;s time zone
              </Button>
            ) : null}
          </div>
        </div>

        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" aria-live="polite">
          Preview: <span className="font-mono text-foreground">{preview.dateTime(SAMPLE)}</span> ·{" "}
          <span className="font-mono text-foreground">{preview.number(1234567.5)}</span>
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {editable ? (
          <div>
            <Button type="button" onClick={save} disabled={!dirty || isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isPending ? "Saving…" : "Save format"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only admins can change this.</p>
        )}
      </CardContent>
    </Card>
  );
}
