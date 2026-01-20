export interface RateLimiterConfig {
  backoffBaseMs: number;
  backoffMaxMs: number;
  maxRetries: number;
}

export interface RateLimitState {
  isBackingOff: boolean;
  backoffUntil: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorTime: number | null;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private state: RateLimitState;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      backoffBaseMs: config.backoffBaseMs ?? 5000,
      backoffMaxMs: config.backoffMaxMs ?? 60000,
      maxRetries: config.maxRetries ?? 3,
    };
    this.state = {
      isBackingOff: false,
      backoffUntil: null,
      consecutiveFailures: 0,
      lastError: null,
      lastErrorTime: null,
    };
  }

  getState(): RateLimitState {
    // Check if backoff period has expired
    if (this.state.backoffUntil && Date.now() >= this.state.backoffUntil) {
      this.state.isBackingOff = false;
      this.state.backoffUntil = null;
    }
    return { ...this.state };
  }

  shouldRetry(): boolean {
    return this.state.consecutiveFailures < this.config.maxRetries;
  }

  recordSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.isBackingOff = false;
    this.state.backoffUntil = null;
  }

  recordFailure(error: string, statusCode?: number): number {
    this.state.consecutiveFailures++;
    this.state.lastError = error;
    this.state.lastErrorTime = Date.now();

    // Calculate backoff with exponential increase
    const backoffMs = Math.min(
      this.config.backoffBaseMs * Math.pow(2, this.state.consecutiveFailures - 1),
      this.config.backoffMaxMs
    );

    this.state.isBackingOff = true;
    this.state.backoffUntil = Date.now() + backoffMs;

    return backoffMs;
  }

  async waitIfNeeded(): Promise<void> {
    const state = this.getState();
    if (state.isBackingOff && state.backoffUntil) {
      const waitMs = state.backoffUntil - Date.now();
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  isRateLimited(statusCode: number): boolean {
    return statusCode === 429 || statusCode === 503;
  }

  getErrorMessage(): string | null {
    if (!this.state.isBackingOff) return null;

    const waitSeconds = this.state.backoffUntil
      ? Math.ceil((this.state.backoffUntil - Date.now()) / 1000)
      : 0;

    if (waitSeconds <= 0) return null;

    return `Rate limited: waiting ${waitSeconds}s before retry. ` +
           `Last error: ${this.state.lastError}. ` +
           `Failures: ${this.state.consecutiveFailures}/${this.config.maxRetries}`;
  }

  getStaleDataWarning(): string | null {
    if (!this.state.lastErrorTime) return null;

    const staleSeconds = Math.floor((Date.now() - this.state.lastErrorTime) / 1000);
    if (staleSeconds < 60) return null;

    const staleMinutes = Math.floor(staleSeconds / 60);
    return `Data may be up to ${staleMinutes} minute(s) stale due to rate limiting`;
  }
}

// Global rate limiter instance (per-isolate)
let globalRateLimiter: RateLimiter | null = null;

export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(config);
  }
  return globalRateLimiter;
}

export function resetRateLimiter(): void {
  globalRateLimiter = null;
}
