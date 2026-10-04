import { z } from "zod";

/**
 * Server-only environment contract. Fails fast with a named variable instead
 * of a mystery crash deep in a request. Never import from client components.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  AUTH_URL: z.string().url().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  // Groq retires models; llama-3.3-70b-versatile was withdrawn in 2026.
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("ResumeRank <onboarding@resend.dev>"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  /** Tokens each company may spend on AI per rolling 30 days, unless Company.aiTokenBudget overrides it. */
  AI_TOKEN_BUDGET: z.coerce.number().int().positive().default(5_000_000),
  /**
   * Header carrying the real client IP when not on Vercel (e.g. cf-connecting-ip
   * behind Cloudflare). Only set it to a header your proxy overwrites.
   */
  TRUSTED_IP_HEADER: z.string().trim().toLowerCase().optional(),
  /** Set by Vercel on every deployment. */
  VERCEL: z.string().optional(),
  /** Bearer token a scheduler sends to /api/cron/scoring; the route is disabled without it. */
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters").optional(),
});

let cached: z.infer<typeof envSchema> | null = null;

export function env(): z.infer<typeof envSchema> {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
