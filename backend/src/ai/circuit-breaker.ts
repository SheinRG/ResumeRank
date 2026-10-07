/**
 * Stops calling a model that keeps failing, so a provider outage costs one
 * fast skip per request instead of a timeout each. State is per process: on
 * serverless each warm instance learns on its own, which still spares every
 * request after the first few on that instance.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** After the cooldown the circuit is half-open: calls go through, and one more failure reopens it. */
  canRequest(): boolean {
    return this.openedAt === null || this.now() - this.openedAt >= this.cooldownMs;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function breakerFor(key: string): CircuitBreaker {
  let breaker = breakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker();
    breakers.set(key, breaker);
  }
  return breaker;
}
