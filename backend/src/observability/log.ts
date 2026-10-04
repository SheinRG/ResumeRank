import { AsyncLocalStorage } from "node:async_hooks";

export type LogFields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

const contextStore = new AsyncLocalStorage<LogFields>();

/**
 * Runs `fn` with fields that every log line written inside it inherits, so a
 * deep call (an LLM attempt inside a service) is still attributable to the
 * action, user and tenant that caused it without threading them through.
 */
export function withLogContext<T>(fields: LogFields, fn: () => T): T {
  return contextStore.run({ ...contextStore.getStore(), ...fields }, fn);
}

/** Adds fields once they are known (e.g. the user, after the guard ran). No-op outside a context. */
export function annotateLogContext(fields: LogFields): void {
  const store = contextStore.getStore();
  if (store) Object.assign(store, fields);
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorName: typeof error, errorMessage: String(error) };
}

function serialize(level: Level, event: string, fields: LogFields): string {
  const entry = {
    level,
    event,
    time: new Date().toISOString(),
    ...contextStore.getStore(),
    ...fields,
  };
  try {
    return JSON.stringify(entry, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    // A circular or otherwise unserialisable field must never turn logging into a crash.
    return JSON.stringify({ level, event, time: entry.time, logError: "unserialisable fields" });
  }
}

/**
 * One JSON object per line on stdout/stderr: log drains (Vercel, Datadog,
 * Axiom, CloudWatch) index the fields without a parser.
 */
export const log = {
  info(event: string, fields: LogFields = {}): void {
    console.log(serialize("info", event, fields));
  },
  warn(event: string, fields: LogFields = {}): void {
    console.warn(serialize("warn", event, fields));
  },
  error(event: string, fields: LogFields = {}): void {
    console.error(serialize("error", event, fields));
  },
};
