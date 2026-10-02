import { redirect } from "next/navigation";

import { signOut } from "@/lib/auth";
import { GateError, requireUser } from "@/lib/auth/guards";

/**
 * Where guards send a dead session (revoked, expired, or deleted account).
 * The proxy bounces any request carrying a session cookie away from /login,
 * so the stale cookie has to be cleared here first or the two redirect into
 * each other. A still-valid session is sent back to the app untouched, which
 * keeps this GET from being usable to log someone out cross-site.
 */
export async function GET(): Promise<never> {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof GateError) {
      await signOut({ redirectTo: "/login?error=SessionExpired" });
    }
    throw error;
  }
  redirect("/dashboard");
}
