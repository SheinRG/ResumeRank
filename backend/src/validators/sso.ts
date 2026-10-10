import { z } from "zod";

import { emailSchema } from "./auth";

const idSchema = z.string().trim().min(1, "Missing id").max(64, "Invalid id");

/** A bare registrable hostname: no scheme, port, path or wildcard. */
const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, "").replace(/\.$/, ""))
  .pipe(z.string().regex(DOMAIN_PATTERN, "Enter a domain like acme.com"));

export const addDomainSchema = z.object({ domain: domainNameSchema });
export type AddDomainInput = z.infer<typeof addDomainSchema>;

export const domainIdSchema = z.object({ domainId: idSchema });
export type DomainIdInput = z.infer<typeof domainIdSchema>;

export const setDomainAutoJoinSchema = z.object({
  domainId: idSchema,
  autoJoin: z.boolean(),
});
export type SetDomainAutoJoinInput = z.infer<typeof setDomainAutoJoinSchema>;

const MAX_METADATA_BYTES = 200_000;

export const samlConnectionSchema = z.object({
  type: z.literal("saml"),
  metadataXml: z
    .string()
    .trim()
    .min(1, "Paste your identity provider's SAML metadata XML")
    .max(MAX_METADATA_BYTES, "That metadata is too large")
    .refine((value) => value.startsWith("<"), "That doesn't look like XML metadata"),
});

export const oidcConnectionSchema = z.object({
  type: z.literal("oidc"),
  discoveryUrl: z
    .string()
    .trim()
    .max(2048, "That link is too long")
    .refine(
      (value) => /^https:\/\//i.test(value) && URL.canParse(value),
      "Enter the https discovery URL (…/.well-known/openid-configuration)",
    ),
  clientId: z.string().trim().min(1, "Client ID is required").max(512, "Client ID is too long"),
  clientSecret: z
    .string()
    .trim()
    .min(1, "Client secret is required")
    .max(2048, "Client secret is too long"),
});

export const saveSsoConnectionSchema = z.discriminatedUnion("type", [
  samlConnectionSchema,
  oidcConnectionSchema,
]);
export type SaveSsoConnectionInput = z.infer<typeof saveSsoConnectionSchema>;

export const setSsoEnforcedSchema = z.object({ enforced: z.boolean() });
export type SetSsoEnforcedInput = z.infer<typeof setSsoEnforcedSchema>;

export const ssoLoginSchema = z.object({ email: emailSchema });
export type SsoLoginInput = z.infer<typeof ssoLoginSchema>;

/**
 * The authorize request Auth.js sends to the SSO service. Narrower than the
 * protocol allows: one product, PKCE always, and only the code flow.
 */
export const ssoAuthorizeRequestSchema = z.object({
  client_id: z.literal("dummy"),
  tenant: z.string().min(1).max(64),
  product: z.string().min(1).max(64),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  state: z.string().min(1).max(512),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().max(512).optional(),
  nonce: z.string().max(512).optional(),
});

/** Auth.js sends the PKCE verifier; it may add client credentials, which the header carries too. */
export const ssoTokenRequestSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1).max(512),
  redirect_uri: z.string().url(),
  code_verifier: z.string().min(43).max(128),
});
