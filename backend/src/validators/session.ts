import { z } from "zod";

import {
  MAX_SESSION_MINUTES,
  MIN_SESSION_IDLE_MINUTES,
  MIN_SESSION_LIFETIME_MINUTES,
} from "../auth/session-policy";

const idSchema = z.string().trim().min(1, "Missing id").max(64, "Invalid id");

export const loginSessionIdSchema = z.object({ sessionId: idSchema });
export type LoginSessionIdInput = z.infer<typeof loginSessionIdSchema>;

export const sessionPolicySchema = z
  .object({
    lifetimeMinutes: z
      .number()
      .int()
      .min(MIN_SESSION_LIFETIME_MINUTES, "Sessions must last at least an hour")
      .max(MAX_SESSION_MINUTES, "Sessions can last at most 30 days"),
    idleMinutes: z
      .number()
      .int()
      .min(MIN_SESSION_IDLE_MINUTES, "Allow at least 15 minutes of inactivity")
      .max(MAX_SESSION_MINUTES, "Allow at most 30 days of inactivity"),
  })
  .refine((policy) => policy.idleMinutes <= policy.lifetimeMinutes, {
    path: ["idleMinutes"],
    message: "The inactivity timeout can't be longer than the session lifetime",
  });
export type SessionPolicyInput = z.infer<typeof sessionPolicySchema>;

export const signOutMemberSchema = z.object({ userId: idSchema });
export type SignOutMemberInput = z.infer<typeof signOutMemberSchema>;
