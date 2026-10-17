import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      sessionVersion: number;
      /** Identifies this one sign-in; absent on sessions issued before MFA existed. */
      loginId: string | null;
      /** The MFA epoch this sign-in proved a second factor against. */
      mfaEpoch: number | null;
    } & DefaultSession["user"];
    /**
     * Only ever sent to a session refresh, never stored: the jwt callback
     * reads it once to mark the sign-in verified (see markSessionVerified).
     */
    mfaProof?: string;
  }

  interface User {
    sessionVersion?: number;
    /** Set by the password provider when the password falls short of the account's policy; recorded on the sign-in. */
    passwordChangeRequired?: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    sessionVersion?: number;
    loginId?: string;
    mfaEpoch?: number;
  }
}
