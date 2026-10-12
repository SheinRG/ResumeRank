import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import * as audit from "@resumerank/core/services/audit";
import type { AuditExportParams } from "@resumerank/core/validators/audit";

export type {
  AuditChainReport,
  AuditSettings,
  AuditStreamSummary,
  SavedAuditStream,
} from "@resumerank/core/services/audit";

export async function getAuditSettings(): Promise<audit.AuditSettings> {
  const user = await requireAdmin();
  return audit.getAuditSettings(tenantContext(user));
}

export async function exportAuditLog(params: AuditExportParams): Promise<audit.AuditExport> {
  const user = await requireAdmin();
  return audit.exportAuditLog(tenantContext(user), params);
}
