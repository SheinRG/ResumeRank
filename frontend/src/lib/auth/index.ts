import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@resumerank/core/db";
import { isGoogleAuthEnabled } from "@resumerank/core/env";
import { verifyPassword } from "@resumerank/core/auth/password";
import {
  beginLoginAttempt,
  clearFailedLogins,
  recordFailedLogin,
} from "@resumerank/core/auth/login-throttle";
import { clientIp } from "@resumerank/core/request-ip";
import { loginSchema } from "@resumerank/core/validators/auth";
import { roleSchema } from "@resumerank/core/validators/enums";

export const TOO_MANY_LOGIN_ATTEMPTS = "too_many_attempts";

/** Thrown instead of checking the password while an IP or account is throttled. */
class TooManyLoginAttempts extends CredentialsSignin {
  code = TOO_MANY_LOGIN_ATTEMPTS;
}

const providers = [
  Credentials({
    credentials: { email: {}, password: {} },
    // Throttling lives here, not in the login form's action: Auth.js also
    // exposes this provider at POST /api/auth/callback/credentials, so any
    // limit outside authorize() could be bypassed by posting there directly.
    async authorize(credentials, request) {
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) return null;
      const { email, password } = parsed.data;

      const gate = await beginLoginAttempt(email, clientIp(request.headers));
      if (!gate.allowed) throw new TooManyLoginAttempts();

      const user = await db.user.findUnique({ where: { email } });
      const valid = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
      if (!user || !valid) {
        await recordFailedLogin(email);
        return null;
      }
      await clearFailedLogins(email);

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: roleSchema.parse(user.role),
        sessionVersion: user.sessionVersion,
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
export type LoginErrorCode =
  | "GoogleEmailUnverified"
  | "AccountNotLinked"
  | "SessionExpired";

function loginError(code: LoginErrorCode): string {
  return `/login?error=${code}`;
}

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: refreshSession,
} = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
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
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.sessionVersion = user.sessionVersion ?? 0;
      }
      // An explicit refresh (after the user changes their own password)
      // re-stamps this session so it survives the revocation it triggered.
      if (trigger === "update" && token.id) {
        const current = await db.user.findUnique({
          where: { id: token.id },
          select: { sessionVersion: true },
        });
        if (current) token.sessionVersion = current.sessionVersion;
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
      session.user.sessionVersion = token.sessionVersion ?? 0;
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
