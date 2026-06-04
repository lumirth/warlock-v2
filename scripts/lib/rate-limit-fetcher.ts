export type CoordinatedFetchConfig = {
  maxConcurrent: number;
  rateLimitWindowMs: number;
  rateLimitBufferMs: number;
  networkTimeoutMs: number;
  headers: Record<string, string>;
};

export type FetchRetryObserver = {
  onRetry?: () => void;
  log?: (message: string) => void;
};

type FetchResult =
  | { ok: true; data: string }
  | { ok: false; error: 'rate_limited' }
  | { ok: false; error: 'network'; message: string };

export const COURSE_EXPLORER_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://courses.illinois.edu/',
};

export class CoordinatedRateLimitFetcher {
  private rateLimitPromise: Promise<void> | null = null;
  private burstStartTime: number | null = null;
  private activeConnections = 0;
  private readonly connectionQueue: Array<() => void> = [];

  constructor(
    private readonly config: CoordinatedFetchConfig,
    private readonly observer: FetchRetryObserver = {},
  ) {}

  recordBurstStart(): void {
    if (this.burstStartTime === null) {
      this.burstStartTime = Date.now();
    }
  }

  async fetchText(url: string): Promise<string> {
    while (true) {
      if (this.rateLimitPromise) {
        await this.rateLimitPromise;
      }

      const result = await this.fetchOnce(url);

      if (result.ok) {
        return result.data;
      }

      if (result.error === 'rate_limited') {
        this.observer.onRetry?.();
        await this.triggerRateLimitWait();
        continue;
      }

      throw new Error(result.message);
    }
  }

  private async fetchOnce(url: string): Promise<FetchResult> {
    await this.acquireConnection();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.networkTimeoutMs);

      try {
        const response = await fetch(url, {
          headers: this.config.headers,
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.status === 403 || response.status === 429) {
          return { ok: false, error: 'rate_limited' };
        }

        if (!response.ok) {
          return { ok: false, error: 'network', message: `HTTP ${response.status}` };
        }

        const data = await response.text();
        return { ok: true, data };
      } catch (err) {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: 'network', message };
      }
    } finally {
      this.releaseConnection();
    }
  }

  private async acquireConnection(): Promise<void> {
    if (this.rateLimitPromise) {
      await this.rateLimitPromise;
    }

    if (this.activeConnections < this.config.maxConcurrent) {
      this.activeConnections++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.connectionQueue.push(() => {
        this.activeConnections++;
        resolve();
      });
    });
  }

  private releaseConnection(): void {
    this.activeConnections--;
    const next = this.connectionQueue.shift();
    if (next) next();
  }

  private async triggerRateLimitWait(): Promise<void> {
    if (this.rateLimitPromise) {
      await this.rateLimitPromise;
      return;
    }

    const waitTime = this.getRateLimitWaitTime();
    const waitMin = (waitTime / 1000 / 60).toFixed(1);
    this.observer.log?.(`\n[RATE LIMIT] Blocked - pausing all requests for ${waitMin}m...`);

    this.rateLimitPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.observer.log?.('[RATE LIMIT] Window expired - resuming');
        this.burstStartTime = null;
        this.rateLimitPromise = null;
        resolve();
      }, waitTime);
    });

    await this.rateLimitPromise;
  }

  private getRateLimitWaitTime(): number {
    const now = Date.now();
    if (this.burstStartTime === null) {
      return this.config.rateLimitWindowMs + this.config.rateLimitBufferMs;
    }
    const windowExpires = this.burstStartTime + this.config.rateLimitWindowMs + this.config.rateLimitBufferMs;
    if (now >= windowExpires) {
      return this.config.rateLimitBufferMs;
    }
    return windowExpires - now;
  }
}
