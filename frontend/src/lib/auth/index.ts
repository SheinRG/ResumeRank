import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import BoxyHQSAML from "next-auth/providers/boxyhq-saml";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { db } from "@resumerank/core/db";
import { isGoogleAuthEnabled, isSsoEnabled } from "@resumerank/core/env";
import { logAuthEvent } from "@resumerank/core/auth/audit";
import { verifyPassword } from "@resumerank/core/auth/password";
import { readMfaProof } from "@resumerank/core/auth/mfa/proof";
import { MAX_SESSION_MINUTES } from "@resumerank/core/auth/session-policy";
import { endLoginSession, startLoginSession } from "@resumerank/core/auth/sessions";
import { passwordSignInRefused } from "@resumerank/core/auth/workspaces";
import type { SignInMethod } from "@resumerank/core/generated/prisma/enums";
import {
  beginLoginAttempt,
  clearFailedLogins,
  recordFailedLogin,
} from "@resumerank/core/auth/login-throttle";
import { log } from "@resumerank/core/observability/log";
import { clientIp, UNKNOWN_IP } from "@resumerank/core/request-ip";
import { SSO_PROVIDER_ID, ssoBaseUrl, ssoClientSecret } from "@resumerank/core/sso/jackson";
import { resolveSsoSignIn } from "@resumerank/core/sso/login";
import type { SsoDenial } from "@resumerank/core/sso/policy";
import { loginSchema } from "@resumerank/core/validators/auth";

export const TOO_MANY_LOGIN_ATTEMPTS = "too_many_attempts";
export const SSO_REQUIRED = "sso_required";

/** Thrown instead of checking the password while an IP or account is throttled. */
class TooManyLoginAttempts extends CredentialsSignin {
  code = TOO_MANY_LOGIN_ATTEMPTS;
}

/** The password was right, but every workspace the user belongs to only allows single sign-on. */
class SsoRequiredSignin extends CredentialsSignin {
  code = SSO_REQUIRED;
}

/** What the SSO service's userinfo endpoint returns, narrowed to what sign-in relies on. */
const ssoProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  requested: z.object({ tenant: z.string().min(1) }),
});

type SsoProfile = z.infer<typeof ssoProfileSchema>;

/** A session refresh carrying a second-factor proof (see markSessionVerified). */
const mfaRefreshSchema = z.object({ mfaProof: z.string().max(256) });

function ssoDisplayName(profile: SsoProfile): string {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return name || profile.email.slice(0, profile.email.indexOf("@"));
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

      const ip = clientIp(request.headers);
      const gate = await beginLoginAttempt(email, ip);
      if (!gate.allowed) throw new TooManyLoginAttempts();

      const user = await db.user.findUnique({ where: { email } });
      const valid = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
      if (!user || !valid) {
        await recordFailedLogin(email);
        // Past the throttle, so a guessing attack can't flood the trail.
        if (user) {
          await logAuthEvent({
            userId: user.id,
            action: "auth.sign_in_failed",
            summary: "failed to sign in with a password",
            metadata: { reason: "wrong_password", ipAddress: ip === UNKNOWN_IP ? null : ip },
          });
        }
        return null;
      }
      await clearFailedLogins(email);

      // Checked only after the password, so the error can't be used to learn
      // which addresses belong to an SSO-only company. Someone who also
      // belongs to a workspace without SSO signs in there instead.
      if (await passwordSignInRefused(user.id)) {
        await logAuthEvent({
          userId: user.id,
          action: "auth.sign_in_refused",
          summary: "was refused a password sign-in because the workspace requires single sign-on",
          metadata: { reason: "sso_required", ipAddress: ip === UNKNOWN_IP ? null : ip },
        });
        throw new SsoRequiredSignin();
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        sessionVersion: user.sessionVersion,
      };
    },
  }),
  // Linking by email is only safe once both sides have proven they own the
  // address; the signIn callback enforces that before Auth.js links anything.
  ...(isGoogleAuthEnabled()
    ? [Google({ allowDangerousEmailAccountLinking: true })]
    : []),
  // One provider fronts every company's SAML/OIDC connection; the tenant is
  // chosen per login (see signInWithSsoAction). Account ids are qualified by
  // tenant because two companies' IdPs can issue the same subject id, and
  // Auth.js signs in whoever an id is linked to. Linking by email is safe
  // because resolveSsoSignIn only lets an IdP vouch for its own verified domains.
  ...(isSsoEnabled()
    ? [
        BoxyHQSAML({
          issuer: ssoBaseUrl(),
          clientId: "dummy",
          clientSecret: ssoClientSecret(),
          // The provider defaults to PKCE alone; the SSO service also
          // requires state, which binds the callback to this browser.
          checks: ["pkce", "state"],
          // Without "openid" in the scope the SSO service skips issuing an ID
          // token, which would need signing keys; the profile comes from userinfo.
          authorization: { params: { scope: "email profile" } },
          allowDangerousEmailAccountLinking: true,
          profile(profile) {
            const parsed = ssoProfileSchema.parse(profile);
            return {
              id: `${parsed.requested.tenant}:${parsed.id}`,
              email: parsed.email.toLowerCase(),
              name: ssoDisplayName(parsed),
              image: null,
            };
          },
        }),
      ]
    : []),
];

/** Error codes the login page knows how to explain. */
export type LoginErrorCode =
  | "GoogleEmailUnverified"
  | "AccountNotLinked"
  | "SessionExpired"
  | "SsoRequired"
  | "SsoFailed"
  | SsoDenial;

function loginError(code: LoginErrorCode): string {
  return `/login?error=${code}`;
}

/**
 * Gate for an identity provider's assertion. The linked account is looked up
 * here rather than read from `user`: Auth.js passes the linked user when the
 * account exists and the provider's profile when it doesn't, and the two
 * can't be told apart by shape.
 */
async function allowSsoSignIn(providerAccountId: string, profile: unknown): Promise<true | string> {
  const parsed = ssoProfileSchema.safeParse(profile);
  if (!parsed.success) return loginError("SsoFailed");

  const linked = await db.account.findUnique({
    where: { provider_providerAccountId: { provider: SSO_PROVIDER_ID, providerAccountId } },
    select: { userId: true },
  });
  const result = await resolveSsoSignIn({
    tenant: parsed.data.requested.tenant,
    email: parsed.data.email,
    name: ssoDisplayName(parsed.data),
    linkedUserId: linked?.userId ?? null,
  });
  if (!result.ok) {
    log.warn("sso.sign_in_refused", { reason: result.reason, companyId: parsed.data.requested.tenant });
    return loginError(result.reason);
  }
  return true;
}

function signInMethod(provider: string | undefined): SignInMethod {
  if (provider === SSO_PROVIDER_ID) return "SSO";
  if (provider === "google") return "GOOGLE";
  return "PASSWORD";
}

/** SSO account ids are `<companyId>:<subject>` (see the provider's profile()). */
function ssoTenantOf(providerAccountId: string): string {
  return providerAccountId.slice(0, providerAccountId.indexOf(":"));
}

/** Records a new sign-in with the device it came from, for the sessions list. */
async function recordLoginSession(
  loginId: string,
  userId: string,
  account: { provider: string; providerAccountId: string } | null | undefined,
) {
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const method = signInMethod(account?.provider);
  await startLoginSession({
    id: loginId,
    userId,
    method,
    userAgent: requestHeaders.get("user-agent"),
    ipAddress: ip === UNKNOWN_IP ? null : ip,
    ssoCompanyId: method === "SSO" && account ? ssoTenantOf(account.providerAccountId) : null,
  });
}

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: refreshSession,
} = NextAuth({
  adapter: PrismaAdapter(db),
  // The cookie outlives any company's policy; the guards end the session
  // sooner from its LoginSession row (lifetime, idle timeout, revocation).
  session: { strategy: "jwt", maxAge: MAX_SESSION_MINUTES * 60 },
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
      if (account?.provider === SSO_PROVIDER_ID) {
        return allowSsoSignIn(account.providerAccountId, profile);
      }
      if (account?.provider !== "google") return true;
      if (profile?.email_verified !== true || !user.email) {
        return loginError("GoogleEmailUnverified");
      }
      const existing = await db.user.findUnique({
        where: { email: user.email },
        select: {
          id: true,
          emailVerified: true,
          accounts: { where: { provider: "google" }, select: { id: true } },
        },
      });
      if (existing && existing.accounts.length === 0 && !existing.emailVerified) {
        return loginError("AccountNotLinked");
      }
      if (existing && (await passwordSignInRefused(existing.id))) {
        return loginError("SsoRequired");
      }
      return true;
    },
    async jwt({ token, user, account, trigger, session }) {
      if (user?.id) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
        // Every sign-in starts without a proven second factor; the guards
        // send it to the challenge if the user has one. The guards also
        // require this sign-in's LoginSession row, which revoking ends; it
        // records how the sign-in started and which workspace it has open.
        token.loginId = randomUUID();
        delete token.mfaEpoch;
        await recordLoginSession(token.loginId, user.id, account);
      }
      if (trigger === "update" && token.id) {
        // An explicit refresh (after the user changes their own password)
        // re-stamps this session so it survives the revocation it triggered.
        const current = await db.user.findUnique({
          where: { id: token.id },
          select: { sessionVersion: true },
        });
        if (current) token.sessionVersion = current.sessionVersion;

        // The browser can post its own refresh payload, so a second factor
        // counts only through a proof the server signed for this sign-in.
        const refresh = mfaRefreshSchema.safeParse(session);
        const epoch =
          refresh.success && token.loginId ? readMfaProof(refresh.data.mfaProof, token.loginId) : null;
        if (epoch !== null) token.mfaEpoch = epoch;
      }
      // An uploaded avatar is an inlined data URL, which would chunk the session
      // cookie across several kilobytes of every request header. Nothing reads
      // the picture from the session — each consumer re-fetches the user row.
      delete token.picture;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      session.user.sessionVersion = token.sessionVersion ?? 0;
      session.user.loginId = token.loginId ?? null;
      session.user.mfaEpoch = token.mfaEpoch ?? null;
      return session;
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && message.token?.loginId) {
        await endLoginSession(message.token.loginId);
      }
    },
    // OAuth sign-ups arrive with a provider-verified email; mirror that into
    // our verification gate. They start with no membership; onboarding
    // resolves whether they create a company or join one by invite.
    async createUser({ user }) {
      if (!user.id) return;
      await db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    },
  },
});
