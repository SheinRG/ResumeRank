import { db } from "./db";
import { errorFields, log } from "./observability/log";

// Long enough for a serverless Postgres (Neon) to wake from suspend, which
// takes ~2s; shorter would page on every cold start.
const DB_TIMEOUT_MS = 5_000;

export interface DependencyCheck {
  ok: boolean;
  latencyMs: number;
}

/**
 * A bounded `SELECT 1`: an uptime monitor needs a fast answer, and a hung
 * connection should read as down rather than make the probe time out. The
 * failure reason goes to the log, never into the public response.
 */
export async function checkDatabase(): Promise<DependencyCheck> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database check timed out")), DB_TIMEOUT_MS);
  });

  try {
    await Promise.race([db.$queryRaw`SELECT 1`, timeout]);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    log.error("health.database", { latencyMs, ...errorFields(error) });
    return { ok: false, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
