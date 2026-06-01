# Cloudflare Hardening Runbook

Date: 2026-06-01

This runbook is intentionally operational. It records what must exist for staging, public abuse controls, D1 restore safety, and smoke proof.

## Auth Preflight

Cloudflare operations require one of:

- Valid Wrangler login: `npx wrangler whoami`
- Non-committed environment credentials: `CLOUDFLARE_API_TOKEN` plus account/project context

Never commit or print secret values.

## Staging Targets

Recommended names:

- Worker: `uiuc-course-search-staging`
- Pages project/branch: `uiuc-course-search-web` / `staging`
- D1: `course-search-db-staging`
- KV: `GPA_CACHE` staging namespace
- Vectorize: `course-embeddings-staging`
- Worker rate limits: `SEARCH_RATE_LIMITER`, `COURSE_RATE_LIMITER`

After creating staging resources, add real non-secret IDs to `apps/api/wrangler.toml` under an explicit `env.staging` block. D1/KV/Vectorize bindings must point at staging resources, not production resources.

## Required Staging Secrets

Set by name only:

```bash
cd apps/api
npx wrangler secret put ADMIN_TOKEN --env staging
npx wrangler secret put INTERNAL_TOKEN --env staging
npx wrangler secret put RMP_AUTH_TOKEN --env staging
```

## Deploy And Smoke

```bash
npm run deploy:api:staging
VITE_API_BASE_URL=https://<staging-worker-host> npm run deploy:web:staging

STAGING_API_BASE_URL=https://<staging-worker-host> \
STAGING_ADMIN_TOKEN=<redacted> \
STAGING_INTERNAL_TOKEN=<redacted> \
npm run test:staging

EVAL_BASE_URL=https://<staging-worker-host> npm run eval:staging
```

Record the deployment targets in the stabilization report using these labels:

```text
Staging API URL: https://<staging-worker-host>
Staging Web URL: https://<staging-pages-host>
Pages Project: uiuc-course-search-web
Pages Branch: staging
```

## WAF / Rate-Limit Policy

Use Cloudflare Workers Rate Limiting bindings for the current `workers.dev` staging API. If a custom zone route is added later, equivalent WAF rate limiting rules are also acceptable.

| Endpoint | Expression Shape | Starting Threshold | Action |
| --- | --- | --- | --- |
| `/api/search*` | `SEARCH_RATE_LIMITER` key `search:<cf-connecting-ip>` | 120 requests/minute/IP | 429 JSON before handler |
| `/api/course/*` | `COURSE_RATE_LIMITER` key `course:<cf-connecting-ip>` | 240 requests/minute/IP | 429 JSON before handler |

Admin/internal token checks remain mandatory regardless of WAF rules.

Record the verified rule shape in the stabilization report using these labels:

```text
Rate-Limit Namespace IDs: SEARCH_RATE_LIMITER=<integer>, COURSE_RATE_LIMITER=<integer>
Abuse Control Routes: /api/search*, /api/course/*
Abuse Control Action: Worker Rate Limiting returns 429 JSON block response before public route handlers
Abuse Control Thresholds: /api/search*=120 requests/min/IP, /api/course/*=240 requests/min/IP
```

Non-destructive smoke:

```bash
curl -i "https://<staging-worker-host>/api/search?q=CS%20225"
curl -i "https://<staging-worker-host>/api/course/CS/225?term=spring&year=2026"
curl -i "https://<staging-worker-host>/admin/terms"
curl -i "https://<staging-worker-host>/admin/sync/status"
curl -i "https://<staging-worker-host>/internal/sync-batch"
```

Expected: public read routes return `200`, unauthenticated admin/internal routes return `401`, and authenticated `npm run test:staging` proves `/admin/sync/status` returns sync and term health arrays.

## D1 Backup And Restore Test

Cloudflare D1 SQL export cannot handle this schema while FTS virtual tables are present. Use D1 Time Travel for the live restore proof:

```bash
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
BOOKMARK=$(npx wrangler d1 time-travel info course-search-db-staging --json)
npx wrangler d1 execute course-search-db-staging --remote --command "INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('restore-test-$BACKUP_REF', 'marker', unixepoch())"
npx wrangler d1 time-travel restore course-search-db-staging --bookmark <bookmark-from-json>
npx wrangler d1 execute course-search-db-staging --remote --command "SELECT COUNT(*) AS marker_count FROM app_meta WHERE key = 'restore-test-$BACKUP_REF'"
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file docs/reports/2026-06-01-stabilization-report.md --restore-verified
```

Record export path, restore DB name, schema verification output, and preflight command output in the stabilization report using these exact evidence labels:

```text
D1 Backup Ref: <YYYYMMDDTHHMMSSZ>
D1 Backup Mechanism: Cloudflare D1 Time Travel
D1 Backup Location: Cloudflare D1 Time Travel bookmark <bookmark> for ref <YYYYMMDDTHHMMSSZ>
D1 Restore Database: course-search-db-staging
D1 Restore Verified: yes
```

## Final Evidence Gate

After staging smoke, staging eval, WAF/rate-limit configuration, and D1 restore testing are recorded, run:

```bash
npm run cloudflare:preflight
```

This gate verifies Wrangler auth, explicit `env.staging` bindings, real-looking non-placeholder staging resource IDs, required staging environment variable names, `artifacts/staging-smoke-results.json`, real HTTPS API and web staging URL evidence, Pages project/branch evidence, Workers rate-limit namespace IDs with route/action/threshold evidence, D1 backup ref/location markers, and D1 restore markers in `docs/reports/2026-06-01-stabilization-report.md`.
