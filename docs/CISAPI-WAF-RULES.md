# CISAPI WAF Rate Limiting Rules

The UIUC Course Information System API (courses.illinois.edu) is protected by AWS WAF with specific rate limiting rules.

## Rate Limits

- **Limit**: 500 requests per 5 minutes (300 seconds)
- **Minimum delay**: 600ms between requests to stay under limit
- **Recommended delay**: 700ms+ to provide safety margin

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

## Implementation Notes

For the historical sync script (`scripts/historical-sync.ts`):

```typescript
const CONFIG = {
  RATE_LIMIT_DELAY_MS: 700,        // 700ms between requests
  RATE_LIMIT_BACKOFF_MS: 60000,    // 60s backoff when blocked
  FETCH_RETRIES: 5,                // Retry up to 5 times
};
```

When a 403 is detected:
1. Wait 60 seconds (increases with each retry)
2. Retry the request
3. If still blocked, wait longer

## Calculating Request Budget

For a full historical sync (2015-present):
- ~12 years × 4 terms × ~180 subjects = ~8,640 subject cascade requests
- Plus ~48 term list requests
- Plus ~48 subject list requests
- Total: ~8,700+ requests

At 700ms per request:
- 8,700 × 0.7s = 6,090 seconds ≈ **101 minutes** (~1.7 hours)

This stays well under the 500 requests/5 minutes limit (at 700ms, we make ~428 requests per 5 minutes).
