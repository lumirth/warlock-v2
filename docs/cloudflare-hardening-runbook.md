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
- Restore-test D1: `course-search-db-staging-restore-<backup-ref>`
- KV: `GPA_CACHE` staging namespace
- Vectorize: `course-embeddings-staging`

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
npm run deploy:api -- --env staging
VITE_API_BASE_URL=https://<staging-worker-host> npm run build -w @uiuc-course-search/web
npx wrangler pages deploy apps/web/dist --project-name uiuc-course-search-web --branch staging

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

Configure Cloudflare WAF or Rate Limiting Rules outside the app for public read endpoints:

| Endpoint | Expression Shape | Starting Threshold | Action |
| --- | --- | --- | --- |
| `/api/search*` | `http.request.uri.path eq "/api/search"` or route-equivalent | 60 requests/minute/IP | Block or managed challenge for 60 seconds |
| `/api/course/*` | `starts_with(http.request.uri.path, "/api/course/")` | 120 requests/minute/IP | Block or managed challenge for 60 seconds |

Admin/internal token checks remain mandatory regardless of WAF rules.

Record the verified rule shape in the stabilization report using these labels:

```text
WAF Rule ID: <uuid>
Abuse Control Routes: /api/search*, /api/course/*
Abuse Control Action: block-or-managed_challenge
Abuse Control Thresholds: /api/search*=60/min/IP, /api/course/*=120/min/IP
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

```bash
mkdir -p artifacts/d1-backups
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
npx wrangler d1 export course-search-db-staging --remote --output artifacts/d1-backups/course-search-db-staging-$BACKUP_REF.sql -y
npx wrangler d1 create course-search-db-staging-restore-$BACKUP_REF
npx wrangler d1 execute course-search-db-staging-restore-$BACKUP_REF --remote --file artifacts/d1-backups/course-search-db-staging-$BACKUP_REF.sql
npx wrangler d1 execute course-search-db-staging-restore-$BACKUP_REF --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file docs/reports/2026-06-01-stabilization-report.md --restore-verified
```

Record export path, restore DB name, schema verification output, and preflight command output in the stabilization report using these exact evidence labels:

```text
D1 Backup Ref: <YYYYMMDDTHHMMSSZ>
D1 Backup Location: artifacts/d1-backups/course-search-db-staging-<YYYYMMDDTHHMMSSZ>.sql
D1 Restore Database: course-search-db-staging-restore-<YYYYMMDDTHHMMSSZ>
D1 Restore Verified: yes
```

## Final Evidence Gate

After staging smoke, staging eval, WAF/rate-limit configuration, and D1 restore testing are recorded, run:

```bash
npm run cloudflare:preflight
```

This gate verifies Wrangler auth, explicit `env.staging` bindings, real-looking non-placeholder staging resource IDs, required staging environment variable names, `artifacts/staging-smoke-results.json`, real HTTPS API and web staging URL evidence, Pages project/branch evidence, real-looking WAF/rate-limit rule IDs with route/action/threshold evidence, D1 backup ref/location markers, and D1 restore markers in `docs/reports/2026-06-01-stabilization-report.md`.
