/**
 * Every feature flag the app knows. A flag is decided per company, so a
 * whole workspace sees one answer.
 *
 * - `release`: a new feature reaching tenants gradually. `rolloutPercent`
 *   turns it on for a stable slice of companies; staff overrides add or
 *   hold back individual ones.
 * - `entitlement`: something a workspace is or isn't allowed to use. Plans
 *   grant them; staff overrides comp or withhold one.
 *
 * Removing a flag is a code change; its leftover override rows are ignored.
 */
export type FlagKind = "release" | "entitlement";

export interface FlagDefinition {
  kind: FlagKind;
  /** Names the feature in messages and the CLI. */
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** 0–100: the share of companies, picked by a stable hash, that get it before overrides. */
  rolloutPercent?: number;
}

export const FLAGS = {
  sso: {
    kind: "entitlement",
    label: "Single sign-on",
    description: "Connecting a SAML or OIDC identity provider and requiring members to sign in through it.",
    defaultEnabled: true,
  },
  "directory-sync": {
    kind: "entitlement",
    label: "Directory sync",
    description: "SCIM provisioning and deprovisioning from the identity provider.",
    defaultEnabled: true,
  },
  "audit-streaming": {
    kind: "entitlement",
    label: "Audit log streaming",
    description: "Streaming audit entries to a webhook, Splunk or Datadog.",
    defaultEnabled: true,
  },
  "resume-files": {
    kind: "entitlement",
    label: "Resume file uploads",
    description: "Uploading PDF and Word resumes, which are kept and read into the candidate's resume text.",
    defaultEnabled: true,
  },
} as const satisfies Record<string, FlagDefinition>;

export type FeatureFlag = keyof typeof FLAGS;

export const FEATURE_FLAGS = Object.keys(FLAGS) as FeatureFlag[];

export function isFeatureFlag(value: string): value is FeatureFlag {
  return Object.hasOwn(FLAGS, value);
}

export function flagDefinition(flag: FeatureFlag): FlagDefinition {
  return FLAGS[flag];
}
