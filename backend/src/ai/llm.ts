import Groq, { APIConnectionError, APIError } from "groq-sdk";

import { env } from "../env";
import { log } from "../observability/log";
import { logRejectedOutput, traceLlmCall, type LlmOperation } from "../observability/llm";
import { DomainError } from "../services/errors";
import { breakerFor } from "./circuit-breaker";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  operation: LlmOperation;
  messages: ChatMessage[];
  temperature: number;
  seed?: number;
  maxTokens: number;
  /** One bounded request; callers own any retry across requests. */
  timeoutMs: number;
}

export interface ProviderCompletion {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}

/** The seam for adding a provider: everything above it is provider-neutral. */
export interface LlmProvider {
  readonly name: string;
  complete(model: string, request: CompletionRequest, attempt: number): Promise<ProviderCompletion>;
}

/** Every model's circuit is open: transient, so the queue backs off and retries. */
export class ProviderUnavailableError extends Error {
  constructor(models: string[]) {
    super(`AI provider unavailable: circuit open for ${models.join(", ")}.`);
    this.name = "ProviderUnavailableError";
  }
}

export interface ProviderFailure {
  retryable: boolean;
  /** The provider rejected our key or model: only an operator can fix it. */
  misconfigured: boolean;
  /** Provider-requested wait (Retry-After), when it sent one. */
  retryAfterMs: number | null;
}

function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Rate limits, timeouts, connection drops and 5xx are transient and worth a
 * delayed retry; anything else (bad key, bad request, malformed output) would
 * fail the same way again.
 */
export function classifyProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderUnavailableError || error instanceof APIConnectionError) {
    return { retryable: true, misconfigured: false, retryAfterMs: null };
  }
  if (error instanceof APIError && typeof error.status === "number") {
    const { status } = error;
    return {
      retryable: status === 408 || status === 409 || status === 429 || status >= 500,
      misconfigured: status === 401 || status === 403 || status === 404,
      retryAfterMs: parseRetryAfter(error.headers?.get("retry-after")),
    };
  }
  return { retryable: false, misconfigured: false, retryAfterMs: null };
}

// One client per key: the SDK pools connections, and a client per call threw
// that away. Its own retries are off because callers own retry policy.
let groqClient: { apiKey: string; client: Groq } | null = null;

function groq(): Groq {
  const apiKey = env().GROQ_API_KEY ?? "";
  if (groqClient?.apiKey !== apiKey) groqClient = { apiKey, client: new Groq({ apiKey, maxRetries: 0 }) };
  return groqClient.client;
}

export const groqProvider: LlmProvider = {
  name: "groq",
  async complete(model, request, attempt) {
    const { completion, usage, latencyMs } = await traceLlmCall(
      { operation: request.operation, provider: "groq", model, attempt },
      () =>
        groq().chat.completions.create(
          {
            model,
            temperature: request.temperature,
            seed: request.seed,
            max_tokens: request.maxTokens,
            response_format: { type: "json_object" },
            messages: request.messages,
          },
          { timeout: request.timeoutMs },
        ),
    );
    return {
      content: completion.choices[0]?.message?.content ?? "",
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs,
    };
  },
};

/** The configured models in the order to try them. */
export function configuredModels(): string[] {
  const { GROQ_MODEL, GROQ_FALLBACK_MODEL } = env();
  return GROQ_FALLBACK_MODEL && GROQ_FALLBACK_MODEL !== GROQ_MODEL
    ? [GROQ_MODEL, GROQ_FALLBACK_MODEL]
    : [GROQ_MODEL];
}

export interface JsonCompletion<T> {
  value: T;
  /** The model that produced `value`, which is the fallback when the primary was skipped. */
  model: string;
  attempts: number;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  rawOutput: string;
}

export interface JsonCompletionOptions<T> {
  request: CompletionRequest;
  /** Throws to reject the output; a DomainError's message is fed back to the model. */
  parse: (raw: string) => T;
  /** Thrown once the model has failed validation twice. */
  exhausted: () => Error;
  models?: string[];
  provider?: LlmProvider;
}

function addTokens(total: number | null, next: number | null): number | null {
  return next === null ? total : (total ?? 0) + next;
}

/**
 * One JSON answer from the first available model. Within a model, one retry
 * feeds the validation failure back (malformed output is the dominant failure
 * and a corrective turn usually fixes it). Across models, a transient or
 * model-not-found provider failure moves on to the fallback; an open circuit
 * skips a model without calling it.
 */
export async function completeJson<T>(options: JsonCompletionOptions<T>): Promise<JsonCompletion<T>> {
  const { request, parse, exhausted, models = configuredModels(), provider = groqProvider } = options;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let latencyMs = 0;
  let attempts = 0;
  let lastProviderError: unknown = null;

  for (const [index, model] of models.entries()) {
    const breaker = breakerFor(`${provider.name}:${model}`);
    if (!breaker.canRequest()) {
      log.warn("llm.circuit_open", { operation: request.operation, model });
      continue;
    }

    let rejection = "";
    try {
      for (let turn = 1; turn <= 2; turn++) {
        attempts += 1;
        const messages: ChatMessage[] = rejection
          ? [
              ...request.messages,
              {
                role: "user",
                content: `Your previous response was rejected: ${rejection}. Return corrected JSON in exactly the required shape.`,
              },
            ]
          : request.messages;
        const completion = await provider.complete(model, { ...request, messages }, turn);
        breaker.recordSuccess();
        promptTokens = addTokens(promptTokens, completion.promptTokens);
        completionTokens = addTokens(completionTokens, completion.completionTokens);
        latencyMs += completion.latencyMs;

        try {
          const value = parse(completion.content);
          return { value, model, attempts, promptTokens, completionTokens, latencyMs, rawOutput: completion.content };
        } catch (error) {
          rejection = error instanceof DomainError ? error.message : "JSON did not match the required schema.";
          logRejectedOutput({ operation: request.operation, provider: provider.name, model, attempt: turn }, rejection);
        }
      }
    } catch (error) {
      breaker.recordFailure();
      const failure = classifyProviderFailure(error);
      const hasFallback = index < models.length - 1;
      if (hasFallback && (failure.retryable || failure.misconfigured)) {
        log.warn("llm.fallback", { operation: request.operation, from: model, to: models[index + 1] });
        lastProviderError = error;
        continue;
      }
      throw error;
    }
    throw exhausted();
  }

  throw lastProviderError ?? new ProviderUnavailableError(models);
}
