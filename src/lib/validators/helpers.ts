import { z } from "zod";

/** Optional free-text field where an empty or whitespace-only string means "not provided". */
export function optionalText(max: number, message: string) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(max, message).optional(),
  );
}
