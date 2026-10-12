import { z } from "zod";

/** Retention periods an owner can choose; null (keep forever) is the default. */
export const AUDIT_RETENTION_DAYS = [90, 180, 365, 730, 1095, 2555] as const;

export const auditRetentionSchema = z.object({
  retentionDays: z.literal(AUDIT_RETENTION_DAYS, { error: "Choose one of the listed periods" }).nullable(),
});
export type AuditRetentionInput = z.infer<typeof auditRetentionSchema>;

export const AUDIT_EXPORT_FORMATS = ["csv", "jsonl"] as const;
export type AuditExportFormat = (typeof AUDIT_EXPORT_FORMATS)[number];

export const auditExportParamsSchema = z
  .object({
    format: z.enum(AUDIT_EXPORT_FORMATS, { error: "Choose CSV or JSON Lines" }),
    from: z.iso.date({ error: "Enter a valid start date" }).optional(),
    to: z.iso.date({ error: "Enter a valid end date" }).optional(),
  })
  .refine((params) => !params.from || !params.to || params.from <= params.to, {
    path: ["to"],
    message: "The end date can't be before the start date",
  });
export type AuditExportParams = z.infer<typeof auditExportParamsSchema>;

export const AUDIT_STREAM_KINDS = ["WEBHOOK", "SPLUNK", "DATADOG"] as const;

export const auditStreamSchema = z.object({
  kind: z.enum(AUDIT_STREAM_KINDS, { error: "Choose where to send events" }),
  url: z
    .string()
    .trim()
    .min(1, "Enter the endpoint URL")
    .max(2048, "That URL is too long")
    .url("Enter a full URL, starting with https://")
    .startsWith("https://", "The URL must start with https://"),
  /** Splunk HEC token or Datadog API key; blank keeps the saved one. Webhooks get a generated secret. */
  token: z.string().trim().max(512, "That token is too long").optional(),
});
export type AuditStreamInput = z.infer<typeof auditStreamSchema>;

export const auditStreamEnabledSchema = z.object({ enabled: z.boolean() });
export type AuditStreamEnabledInput = z.infer<typeof auditStreamEnabledSchema>;
