import { db } from "../db";
import { env, isBillingEnabled } from "../env";
import { errorFields, log } from "../observability/log";
import { stripeGateway, type BillingGateway } from "./gateway";

/** A run that finished this recently may still be committing; it's left for the next pass. */
const SETTLE_MS = 5 * 60 * 1000;
/** Stripe refuses meter events older than 35 days. */
const MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

export interface MeteringOptions {
  gateway?: BillingGateway;
  now?: Date;
}

/**
 * Sends each paying company's scoring tokens to the Stripe meter, one event
 * per run, in finish order, moving `meteredThrough` past what was sent.
 * Plans cap usage rather than bill overage, so this is for visibility in
 * Stripe. Each event is identified by its run, so re-sending after a crash
 * or an overlapping pass counts once.
 */
export async function reportAiUsage(options: MeteringOptions = {}): Promise<{ reported: number }> {
  if (!isBillingEnabled() || !env().STRIPE_AI_METER_EVENT) return { reported: 0 };
  const { gateway = stripeGateway(), now = new Date() } = options;
  const settled = new Date(now.getTime() - SETTLE_MS);
  const oldest = new Date(now.getTime() - MAX_AGE_MS);

  const accounts = await db.billingAccount.findMany({
    where: { stripeCustomerId: { not: null }, meteredThrough: { not: null, lt: settled } },
    select: { companyId: true, stripeCustomerId: true, meteredThrough: true },
  });

  let reported = 0;
  for (const account of accounts) {
    const { stripeCustomerId: customerId, meteredThrough } = account;
    if (!customerId || !meteredThrough) continue;

    const runs = await db.scoringRun.findMany({
      where: { companyId: account.companyId, status: "SUCCEEDED", finishedAt: { gt: meteredThrough, lte: settled } },
      orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
      select: { id: true, finishedAt: true, promptTokens: true, completionTokens: true },
    });

    let cursor = runs.length < BATCH_SIZE ? settled : meteredThrough;
    for (const run of runs) {
      const finishedAt = run.finishedAt ?? settled;
      const tokens = (run.promptTokens ?? 0) + (run.completionTokens ?? 0);
      if (tokens > 0 && finishedAt >= oldest) {
        try {
          await gateway.reportUsage({ customerId, tokens, identifier: `scoring-run:${run.id}`, timestamp: finishedAt });
          reported += 1;
        } catch (error) {
          log.warn("billing.usage_report_failed", { companyId: account.companyId, ...errorFields(error) });
          cursor = new Date(finishedAt.getTime() - 1);
          break;
        }
      }
      // A full batch stops just short of its last timestamp, so runs sharing
      // it beyond the batch are read again next time rather than skipped.
      if (runs.length === BATCH_SIZE) cursor = new Date(finishedAt.getTime() - 1);
    }

    if (cursor > meteredThrough) {
      await db.billingAccount.update({ where: { companyId: account.companyId }, data: { meteredThrough: cursor } });
    }
  }
  return { reported };
}
