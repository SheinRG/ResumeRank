import { DEFAULT_FORMAT_PREFS, type FormatPrefs } from "@resumerank/core/locale";

export interface Formatters {
  /** "Oct 19, 2026" in en-US: the day, in the viewer's time zone. */
  date(value: Date | string | number): string;
  /** The day and the time, in the viewer's time zone. */
  dateTime(value: Date | string | number): string;
  /** "3 minutes ago", "in 2 days". */
  relative(value: Date | string | number, now?: Date | string | number): string;
  number(value: number): string;
  /** "1 job", "25 jobs", or "1,000+ jobs" once a list stops counting exactly. */
  count(count: { total: number; totalCapped: boolean }, noun: string): string;
}

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: "week", ms: 1000 * 60 * 60 * 24 * 7 },
  { unit: "day", ms: 1000 * 60 * 60 * 24 },
  { unit: "hour", ms: 1000 * 60 * 60 },
  { unit: "minute", ms: 1000 * 60 },
  { unit: "second", ms: 1000 },
];

// Intl formatters are costly to build; one set per locale and zone serves every render.
const cache = new Map<string, Formatters>();

/**
 * Formatting for one locale and time zone. Dates are shown in the viewer's
 * zone, not the server's, so a late-evening event in Mumbai doesn't read as
 * the next day because the server runs on UTC.
 */
export function createFormatters(prefs: FormatPrefs = DEFAULT_FORMAT_PREFS): Formatters {
  const key = `${prefs.locale}|${prefs.timeZone}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { locale, timeZone } = prefs;
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone });
  const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  const numberFormat = new Intl.NumberFormat(locale);
  const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const formatters: Formatters = {
    date: (value) => dateFormat.format(new Date(value)),
    dateTime: (value) => dateTimeFormat.format(new Date(value)),
    relative(value, now = Date.now()) {
      const diffMs = new Date(value).getTime() - new Date(now).getTime();
      const absMs = Math.abs(diffMs);
      for (const { unit, ms } of RELATIVE_UNITS) {
        if (absMs >= ms || unit === "second") return relativeFormat.format(Math.round(diffMs / ms), unit);
      }
      return relativeFormat.format(0, "second");
    },
    number: (value) => numberFormat.format(value),
    count(count, noun) {
      const plural = count.total !== 1 || count.totalCapped;
      return `${numberFormat.format(count.total)}${count.totalCapped ? "+" : ""} ${noun}${plural ? "s" : ""}`;
    },
  };
  cache.set(key, formatters);
  return formatters;
}

/** "820 KB", "3.4 MB": file sizes as people read them, in powers of 1024. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";

  return `${first}${last}`.toUpperCase();
}
