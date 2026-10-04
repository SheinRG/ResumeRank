import { db } from "./db";
import { env } from "./env";
import { recordUsage, usageInWindow } from "./rate-limit";
import { DomainError } from "./services/errors";

/** Rolling, not calendar: a tenant's spend over any 30 days stays under budget. */
export const AI_BUDGET_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function budgetKey(companyId: string): string {
  return `ai-tokens:company:${companyId}`;
}

export interface AiBudget {
  used: number;
  budget: number;
  remaining: number;
}

export async function getAiBudget(companyId: string): Promise<AiBudget> {
  const [company, used] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { aiTokenBudget: true } }),
    usageInWindow(budgetKey(companyId), AI_BUDGET_WINDOW_MS),
  ]);
  const budget = company?.aiTokenBudget ?? env().AI_TOKEN_BUDGET;
  const rounded = Math.round(used);
  return { used: rounded, budget, remaining: Math.max(0, budget - rounded) };
}

export const AI_BUDGET_EXHAUSTED =
  "Your workspace has used its AI budget for the last 30 days. Scoring resumes as older usage ages out, or an owner can raise the budget.";

/**
 * Checked before work starts, charged after it finishes: the exact token
 * count is only known once the model has answered, so a tenant can overshoot
 * by at most the requests already in flight.
 */
export async function assertAiBudget(companyId: string): Promise<void> {
  const { remaining } = await getAiBudget(companyId);
  if (remaining <= 0) throw new DomainError(AI_BUDGET_EXHAUSTED);
}

export async function chargeAiTokens(companyId: string, tokens: number | null): Promise<void> {
  if (!tokens) return;
  await recordUsage(budgetKey(companyId), AI_BUDGET_WINDOW_MS, tokens);
}
