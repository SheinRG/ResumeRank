import { hkdfSync } from "node:crypto";

import { controllers, type JacksonOption, type SAMLJackson } from "@boxyhq/saml-jackson";

import { env } from "../env";
import { log } from "../observability/log";
import { ssoStore } from "./store";

/** Jackson's tenant/product pair: the tenant is the company id, the product is always this app. */
export const SSO_PRODUCT = "resumerank";

/** The Auth.js provider id that fronts Jackson (next-auth/providers/boxyhq-saml). */
export const SSO_PROVIDER_ID = "boxyhq-saml";

export const SSO_PATHS = {
  authorize: "/api/oauth/authorize",
  saml: "/api/oauth/saml",
  oidc: "/api/oauth/oidc",
  token: "/api/oauth/token",
  userinfo: "/api/oauth/userinfo",
} as const;

/** How long an in-flight login (session, code, access token) stays usable. */
const LOGIN_TTL_SECONDS = 300;

export class SsoUnavailableError extends Error {
  constructor() {
    super("Single sign-on is not configured: set SSO_ENCRYPTION_KEY.");
    this.name = "SsoUnavailableError";
  }
}

/** The public origin IdPs post back to; it has to be stable, so it comes from config rather than the request. */
export function ssoBaseUrl(): string {
  const { AUTH_URL, NEXT_PUBLIC_APP_URL } = env();
  return new URL(AUTH_URL ?? NEXT_PUBLIC_APP_URL).origin;
}

export function ssoCallbackUrl(): string {
  return `${ssoBaseUrl()}/api/auth/callback/${SSO_PROVIDER_ID}`;
}

/** What an admin pastes into their identity provider. */
export interface ServiceProviderDetails {
  acsUrl: string;
  entityId: string;
  oidcRedirectUrl: string;
}

export function serviceProviderDetails(): ServiceProviderDetails {
  const base = ssoBaseUrl();
  return {
    acsUrl: `${base}${SSO_PATHS.saml}`,
    entityId: base,
    oidcRedirectUrl: `${base}${SSO_PATHS.oidc}`,
  };
}

function subkey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
}

/**
 * The secret Auth.js presents when it trades a login code for a token. Both
 * ends live in this app, so it is derived rather than configured; rotating
 * AUTH_SECRET only voids logins that are mid-flight.
 */
export function ssoClientSecret(): string {
  return subkey(env().AUTH_SECRET, "resumerank:sso-client-secret:v1").toString("base64url");
}

function options(encryptionKey: string): JacksonOption {
  const base = ssoBaseUrl();
  return {
    externalUrl: base,
    samlPath: SSO_PATHS.saml,
    oidcPath: SSO_PATHS.oidc,
    samlAudience: base,
    idpEnabled: false,
    noAnalytics: true,
    clientSecretVerifier: ssoClientSecret(),
    openid: { redirectExactMatch: true },
    db: {
      driver: ssoStore,
      // Jackson reads a 44-character value as base64; a fixed-size subkey
      // means any SSO_ENCRYPTION_KEY of 32+ characters yields AES-256.
      encryptionKey: subkey(encryptionKey, "resumerank:sso-store:v1").toString("base64"),
      ttl: LOGIN_TTL_SECONDS,
    },
    logger: {
      info: (message: string) => log.info("sso.jackson", { message }),
      warn: (message: string) => log.warn("sso.jackson", { message }),
      error: (message: string, error?: unknown) =>
        log.error("sso.jackson", { message, error: error instanceof Error ? error.message : String(error ?? "") }),
    },
  };
}

const globalForSso = globalThis as unknown as { resumerankSso?: Promise<SAMLJackson> };

/**
 * One Jackson instance per process. The first call creates the SP signing
 * certificate if the store has none, so it can take a moment; a failed start
 * is forgotten so the next request retries instead of caching the failure.
 */
export function ssoControllers(): Promise<SAMLJackson> {
  const key = env().SSO_ENCRYPTION_KEY;
  if (!key) return Promise.reject(new SsoUnavailableError());

  globalForSso.resumerankSso ??= controllers(options(key)).catch((error: unknown) => {
    globalForSso.resumerankSso = undefined;
    throw error;
  });
  return globalForSso.resumerankSso;
}

/** Stops Jackson's background timers; tests call it so the process can exit. */
export async function closeSso(): Promise<void> {
  const pending = globalForSso.resumerankSso;
  globalForSso.resumerankSso = undefined;
  if (pending) await (await pending).close();
}

/** Jackson's own failures carry an HTTP status; 4xx ones describe bad input and are safe to show. */
export function jacksonClientError(error: unknown): string | null {
  if (!(error instanceof Error) || !("statusCode" in error)) return null;
  const status = error.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? error.message : null;
}

export function jacksonStatus(error: unknown): number {
  if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}
