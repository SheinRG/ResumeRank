/**
 * How dates and numbers are shown: a BCP 47 locale and an IANA time zone.
 * A person's own choice wins; otherwise their workspace's default applies.
 * Only formatting follows the locale; the interface text is English.
 *
 * No dependencies: it is imported by every page that shows a date, so it
 * must stay small. The form schemas live in validators/locale.ts.
 */
export interface FormatPrefs {
  locale: string;
  timeZone: string;
}

export const DEFAULT_FORMAT_PREFS: FormatPrefs = { locale: "en-US", timeZone: "UTC" };

/** Offered in settings; each formats dates and numbers its own way. */
export const SUPPORTED_LOCALES = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "de-DE", label: "Deutsch (Deutschland)" },
  { value: "fr-FR", label: "Français (France)" },
  { value: "es-ES", label: "Español (España)" },
  { value: "es-MX", label: "Español (México)" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "nl-NL", label: "Nederlands (Nederland)" },
  { value: "it-IT", label: "Italiano (Italia)" },
  { value: "ja-JP", label: "日本語 (日本)" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["value"];

export const LOCALE_VALUES = SUPPORTED_LOCALES.map((locale) => locale.value) as [SupportedLocale, ...SupportedLocale[]];

/** True for a zone the runtime's time zone database knows, by its canonical IANA name or an alias. */
export function isTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isSupportedLocale(value: string): boolean {
  return SUPPORTED_LOCALES.some((locale) => locale.value === value);
}

/**
 * The person's choice if they made one, else the workspace's, else the
 * defaults. A stored value the runtime no longer knows (a zone removed from
 * its database) is skipped rather than allowed to throw on every page.
 */
export function resolveFormatPrefs(
  person: { locale: string | null; timeZone: string | null },
  workspace: { locale: string; timeZone: string } | null,
): FormatPrefs {
  const locale = [person.locale, workspace?.locale].find((value) => value && isSupportedLocale(value));
  const timeZone = [person.timeZone, workspace?.timeZone].find((value) => value && isTimeZone(value));
  return {
    locale: locale ?? DEFAULT_FORMAT_PREFS.locale,
    timeZone: timeZone ?? DEFAULT_FORMAT_PREFS.timeZone,
  };
}

/** Every zone the runtime knows, UTC first, for the settings pickers. */
export function listTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC");
  return ["UTC", ...zones];
}
