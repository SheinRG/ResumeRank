"use client";

import { createContext, useContext, type ReactNode } from "react";

import { createFormatters, type Formatters } from "@/lib/format";
import { DEFAULT_FORMAT_PREFS, type FormatPrefs } from "@resumerank/core/locale";

const FormatContext = createContext<FormatPrefs>(DEFAULT_FORMAT_PREFS);

/** The signed-in person's locale and time zone, for every date and number below it. */
export function FormatProvider({ prefs, children }: { prefs: FormatPrefs; children: ReactNode }) {
  return <FormatContext.Provider value={prefs}>{children}</FormatContext.Provider>;
}

export function useFormatPrefs(): FormatPrefs {
  return useContext(FormatContext);
}

export function useFormat(): Formatters {
  const prefs = useContext(FormatContext);
  return createFormatters(prefs);
}

type DateKind = "date" | "dateTime" | "relative";

/**
 * A date in the viewer's locale and zone, for server and client components
 * alike. The full date and time is in the tooltip, and the machine-readable
 * instant in `dateTime`.
 */
export function DateText({ value, kind = "date" }: { value: Date | string | number; kind?: DateKind }) {
  const format = useFormat();
  const date = new Date(value);
  const text = kind === "date" ? format.date(date) : kind === "dateTime" ? format.dateTime(date) : format.relative(date);
  return (
    // "3 minutes ago" can tick over between the server render and hydration.
    <time dateTime={date.toISOString()} title={format.dateTime(date)} suppressHydrationWarning={kind === "relative"}>
      {text}
    </time>
  );
}

export function NumberText({ value }: { value: number }) {
  return <>{useFormat().number(value)}</>;
}

export function CountText({ count, noun }: { count: { total: number; totalCapped: boolean }; noun: string }) {
  return <>{useFormat().count(count, noun)}</>;
}
