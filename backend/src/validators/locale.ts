import { z } from "zod";

import { isTimeZone, LOCALE_VALUES } from "../locale";

export const localeSchema = z.enum(LOCALE_VALUES, { error: "Choose one of the listed languages" });
export const timeZoneSchema = z.string().trim().refine(isTimeZone, "Choose a time zone from the list");

/** A person's own choice; null for either follows the workspace default. */
export const personalFormatSchema = z.object({
  locale: localeSchema.nullable(),
  timeZone: timeZoneSchema.nullable(),
});
export type PersonalFormatInput = z.infer<typeof personalFormatSchema>;

export const workspaceFormatSchema = z.object({
  locale: localeSchema,
  timeZone: timeZoneSchema,
});
export type WorkspaceFormatInput = z.infer<typeof workspaceFormatSchema>;
