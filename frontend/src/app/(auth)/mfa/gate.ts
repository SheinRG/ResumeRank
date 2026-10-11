import { redirect } from "next/navigation";

import { GateError, getSignedInSession, type SignedInSession } from "@/lib/auth/guards";

/** The signed-in session for a page of the two-factor step; dead sessions leave through /session-ended. */
export async function loadMfaSession(): Promise<SignedInSession> {
  try {
    return await getSignedInSession();
  } catch (error) {
    if (error instanceof GateError) redirect("/session-ended");
    throw error;
  }
}
