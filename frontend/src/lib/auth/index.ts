import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@resumerank/core/db";
import { isGoogleAuthEnabled } from "@resumerank/core/env";
import { verifyPassword } from "@resumerank/core/auth/password";
import { loginSchema } from "@resumerank/core/validators/auth";
import { roleSchema } from "@resumerank/core/validators/enums";

const providers = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) return null;

      const user = await db.user.findUnique({
        where: { email: parsed.data.email },
      });
      if (!user?.passwordHash) return null;

      const valid = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!valid) return null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: roleSchema.parse(user.role),
      };
    },
  }),
  // Linking by email is only safe once both sides have proven they own the
  // address; the signIn callback enforces that before Auth.js links anything.
  ...(isGoogleAuthEnabled()
    ? [Google({ allowDangerousEmailAccountLinking: true })]
    : []),
];

/** Error codes the login page knows how to explain. */
export type LoginErrorCode = "GoogleEmailUnverified" | "AccountNotLinked";

function loginError(code: LoginErrorCode): string {
  return `/login?error=${code}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers,
  callbacks: {
    /**
     * Blocks pre-account takeover: someone registers a password account with a
     * victim's address and waits for the victim to "Sign in with Google" into
     * it. A Google login may join an existing account only if Google vouches
     * for the address and the existing account has verified it too.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      if (profile?.email_verified !== true || !user.email) {
        return loginError("GoogleEmailUnverified");
      }
      const existing = await db.user.findUnique({
        where: { email: user.email },
        select: {
          emailVerified: true,
          accounts: { where: { provider: "google" }, select: { id: true } },
        },
      });
      if (existing && existing.accounts.length === 0 && !existing.emailVerified) {
        return loginError("AccountNotLinked");
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }
      // An uploaded avatar is an inlined data URL, which would chunk the session
      // cookie across several kilobytes of every request header. Nothing reads
      // the picture from the session — each consumer re-fetches the user row.
      delete token.picture;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      session.user.role = token.role ?? "MEMBER";
      return session;
    },
  },
  events: {
    // OAuth sign-ups arrive with a provider-verified email; mirror that into
    // our verification gate. Role stays MEMBER and companyId stays null —
    // onboarding resolves whether they create a company or join one by invite.
    async createUser({ user }) {
      if (!user.id) return;
      await db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    },
  },
});
