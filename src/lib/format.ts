const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", {
  numeric: "auto",
});

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
  { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
  { unit: "week", ms: 1000 * 60 * 60 * 24 * 7 },
  { unit: "day", ms: 1000 * 60 * 60 * 24 },
  { unit: "hour", ms: 1000 * 60 * 60 },
  { unit: "minute", ms: 1000 * 60 },
  { unit: "second", ms: 1000 },
];

export function formatDate(date: Date | string | number): string {
  return dateFormatter.format(new Date(date));
}

export function formatRelative(
  date: Date | string | number,
  now: Date | string | number = Date.now(),
): string {
  const diffMs = new Date(date).getTime() - new Date(now).getTime();
  const absMs = Math.abs(diffMs);

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (absMs >= ms || unit === "second") {
      return relativeFormatter.format(Math.round(diffMs / ms), unit);
    }
  }

  return relativeFormatter.format(0, "second");
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
