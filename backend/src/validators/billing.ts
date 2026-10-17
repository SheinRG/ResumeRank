import { z } from "zod";

import { PAID_PLANS } from "../billing/plans";

export const checkoutSchema = z.object({ plan: z.enum(PAID_PLANS, { error: "Choose a plan" }) });
export type CheckoutInput = z.infer<typeof checkoutSchema>;
