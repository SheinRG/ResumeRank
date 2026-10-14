import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as features from "@resumerank/core/services/features";

export type { FeatureSet } from "@resumerank/core/services/features";

export async function getFeatures(): Promise<features.FeatureSet> {
  const user = await requireMember();
  return features.getFeatures(tenantContext(user));
}
