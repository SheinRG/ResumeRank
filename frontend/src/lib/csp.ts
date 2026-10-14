import { createHash } from "node:crypto";

const isDev = process.env.NODE_ENV === "development";

/** Request header the proxy passes the nonce on to the root layout. */
export const NONCE_HEADER = "x-nonce";

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function sha256Source(code: string): string {
  return `'sha256-${createHash("sha256").update(code).digest("base64")}'`;
}

type ScriptPolicy =
  | { nonce: string }
  | { hashes: string[]; eventHandlerHashes?: string[] }
  | "none";

function scriptSources(policy: ScriptPolicy): string {
  // React reconstructs server error stacks with eval in development only.
  const devEval = isDev ? " 'unsafe-eval'" : "";
  if (policy === "none") return `'self'${devEval}`;
  if ("nonce" in policy) {
    // 'strict-dynamic' lets the nonced runtime load its chunks; browsers that
    // understand it ignore 'self', older ones fall back to it.
    return `'self' 'nonce-${policy.nonce}' 'strict-dynamic'${devEval}`;
  }
  const handlers = policy.eventHandlerHashes ?? [];
  return [
    "'self'",
    ...policy.hashes,
    ...(handlers.length > 0 ? ["'unsafe-hashes'", ...handlers] : []),
  ].join(" ") + devEval;
}

export function contentSecurityPolicy(script: ScriptPolicy, formAction = "'self'"): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSources(script)}`,
    // Inline style attributes come from React's server render (status chips,
    // motion initial states); styles can't run code, so they stay allowed.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://lh3.googleusercontent.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action ${formAction}`,
  ].join("; ");
}

/**
 * The SSO service answers a SAML POST-binding login with its own page: an
 * `onload` that submits the form and an inline script that hides it. Allowing
 * exactly those two snippets by hash keeps the page working without opening
 * inline scripts; if a library upgrade changes them, the page degrades to its
 * visible Continue button instead of running anything else.
 */
export function samlPostFormPolicy(): string {
  return contentSecurityPolicy(
    {
      hashes: [sha256Source('document.forms[0].style.display="none";')],
      eventHandlerHashes: [sha256Source("document.forms[0].submit()")],
    },
    // The form posts to the tenant's identity provider, whatever host it is.
    "'self' https:",
  );
}
