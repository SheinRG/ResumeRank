import type { DefaultSession } from "next-auth";
import type { Role } from "@resumerank/core/validators/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      sessionVersion: number;
      viaSso: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    sessionVersion?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    sessionVersion?: number;
    viaSso?: boolean;
  }
}
