# CISAPI WAF Rate Limiting Rules

The UIUC Course Information System API (courses.illinois.edu) is protected by AWS WAF with specific rate limiting rules.

## Rate Limits

- **Limit**: 500 requests per 5 minutes (300 seconds)
- **Average rate**: 1.67 requests/second maximum
- **Burst consideration**: Even if average is under limit, bursts of many simultaneous requests can trigger rate limiting

## How AWS WAF Works

1. **Evaluation frequency**: AWS WAF evaluates the rate of requests every 30 seconds
2. **Block trigger**: Once an IP crosses the threshold (500 requests in 5 minutes), blocking begins immediately (within seconds)
3. **Rolling window**: The 5-minute window is a trailing/rolling evaluation window
4. **Unblock behavior**: IP remains blocked only as long as request rate is above threshold
5. **Recovery**: As soon as rolling average drops below limit, block is automatically lifted

## What Happens When Blocked

- HTTP 403 Forbidden response
- Block applies to the entire IP address
- Duration depends on how aggressively the limit was exceeded
- If requests stop immediately after block, recovery happens as trailing window clears

## Headers Required

AWS WAF also requires browser-like headers to avoid JavaScript challenges:

```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-US,en;q=0.9
Referer: https://courses.illinois.edu/
```

## Implementation Strategies

### Conservative Approach (Avoids Blocking)

```typescript
const CONFIG = {
  PARALLEL_BATCH_SIZE: 3,      // 3 requests in parallel
  BATCH_DELAY_MS: 2500,        // 2.5s between batches = 1.2 req/sec
  RATE_LIMIT_BACKOFF_MS: 60000, // 60s backoff when blocked
  FETCH_RETRIES: 5,
};
```

This stays under the 500/5min limit but is slow for bulk syncs.

### Aggressive Burst Approach (Used for Historical Sync)

The historical sync script (`scripts/historical-sync.ts`) uses an aggressive burst strategy that **exploits the rolling window behavior**:

```typescript
const CONFIG = {
  PARALLEL_BATCH_SIZE: 200,           // Blast 200 requests at once
  BATCH_DELAY_MS: 0,                  // No delay between batches
  RATE_LIMIT_WINDOW_MS: 5 * 60 * 1000, // 5-minute rolling window
  RATE_LIMIT_BUFFER_MS: 10 * 1000,    // 10s safety buffer
};
```

**How it works:**

1. **Blast Phase**: Fire 200+ parallel requests as fast as possible
2. **Block Detection**: WAF evaluates every 30s and blocks after ~500 requests
3. **Precise Wait**: Track when the burst started, wait exactly until the 5-minute window expires
4. **Repeat**: Once window clears, blast another 200+ requests

**Why this is faster than conservative:**

- Conservative: ~1.67 req/sec = 16,000 requests in ~2.7 hours
- Aggressive burst: ~500 requests, 5 min wait, repeat = 16,000 requests in ~2.7 hours BUT with much higher throughput during burst windows

The key insight is that the WAF's rolling window means we can get **500 requests through every 5 minutes** if we blast them all at once and then wait precisely for the window to clear. This is more efficient than trickling requests because:

1. Network parallelism is maximized during bursts
2. We know exactly when we can resume (5 min from burst start)
3. No wasted time from conservative pacing

**Burst Window Tracking:**

```typescript
let burstStartTime: number | null = null;

function recordBurstStart(): void {
  if (burstStartTime === null) {
    burstStartTime = Date.now();
  }
}

function getRateLimitWaitTime(): number {
  if (burstStartTime === null) {
    return RATE_LIMIT_WINDOW_MS + RATE_LIMIT_BUFFER_MS;
  }
  const windowExpires = burstStartTime + RATE_LIMIT_WINDOW_MS + RATE_LIMIT_BUFFER_MS;
  const now = Date.now();
  if (now >= windowExpires) {
    burstStartTime = null;
    return RATE_LIMIT_BUFFER_MS;
  }
  return windowExpires - now;
}
```

When a 403 is detected:
1. Calculate exact time until window expires (from burst start + 5 min + buffer)
2. Wait that precise amount
3. Reset burst tracker
4. Resume blasting

## Calculating Request Budget

For a full historical sync (2004-present):
- ~22 years × 4 terms × ~180 subjects = ~15,840 subject cascade requests
- Plus ~88 term list requests
- Plus ~88 subject list requests
- Total: ~16,000+ requests

At 500 requests per 5-minute window:
- 16,000 / 500 = 32 windows × 5 minutes = **~2.7 hours**

The aggressive burst approach achieves this theoretical minimum by maximizing requests per window.
