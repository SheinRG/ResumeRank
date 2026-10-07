import { SpanStatusCode, trace } from "@opentelemetry/api";
import { errorFields, log } from "./log";

export type LlmOperation = "scoring" | "extraction";

export interface LlmCallInfo {
  operation: LlmOperation;
  /** The provider's GenAI system name, e.g. "groq". */
  provider: string;
  model: string;
  attempt: number;
}

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

interface CompletionLike {
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface TracedCompletion<T> {
  completion: T;
  usage: LlmUsage;
  latencyMs: number;
}

const tracer = trace.getTracer("resumerank");

function providerStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/**
 * Wraps one provider call in a span (OpenTelemetry GenAI attribute names) and
 * an `llm.call` log line with latency, token usage and the attempt number, so
 * cost, slowness and retry rates are visible per tenant. Without a registered
 * SDK the span is a no-op and only the log line remains.
 */
export async function traceLlmCall<T extends CompletionLike>(
  info: LlmCallInfo,
  call: () => Promise<T>,
): Promise<TracedCompletion<T>> {
  return tracer.startActiveSpan(`llm.${info.operation}`, async (span) => {
    span.setAttributes({
      "gen_ai.system": info.provider,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": info.model,
      "resumerank.llm.attempt": info.attempt,
    });
    const started = performance.now();
    try {
      const completion = await call();
      const latencyMs = Math.round(performance.now() - started);
      const usage: LlmUsage = {
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
      };
      if (usage.promptTokens !== null) {
        span.setAttribute("gen_ai.usage.input_tokens", usage.promptTokens);
      }
      if (usage.completionTokens !== null) {
        span.setAttribute("gen_ai.usage.output_tokens", usage.completionTokens);
      }
      log.info("llm.call", { ...info, outcome: "ok", latencyMs, ...usage });
      return { completion, usage, latencyMs };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started);
      const status = providerStatus(error);
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      log.error("llm.call", {
        ...info,
        outcome: "provider_error",
        latencyMs,
        status,
        ...errorFields(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** The model answered but its output failed validation; the engine retries or gives up. */
export function logRejectedOutput(info: LlmCallInfo, reason: string): void {
  log.warn("llm.output_rejected", { ...info, reason });
}
