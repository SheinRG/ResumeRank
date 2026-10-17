import { z } from "zod";

import { parseIpRange } from "../auth/ip-allowlist";

const idSchema = z.string().trim().min(1, "Missing id").max(64, "Invalid id");

export const addIpRangeSchema = z.object({
  cidr: z
    .string()
    .max(64, "Enter an IP address or a range like 203.0.113.0/24.")
    .transform((value, ctx) => {
      const parsed = parseIpRange(value);
      if ("error" in parsed) {
        ctx.addIssue({ code: "custom", message: parsed.error });
        return z.NEVER;
      }
      return parsed.cidr;
    }),
  // Nullable too: the form sends the parsed input on, and the action parses it again.
  label: z
    .string()
    .trim()
    .max(60, "Keep the label under 60 characters")
    .nullish()
    .transform((value) => value || null),
});
export type AddIpRangeInput = z.infer<typeof addIpRangeSchema>;

export const ipRangeIdSchema = z.object({ rangeId: idSchema });
export type IpRangeIdInput = z.infer<typeof ipRangeIdSchema>;
