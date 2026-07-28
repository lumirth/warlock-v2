# Pre-Alpha Release Checklist

Use this checklist before any public demo. The project is greenfield/pre-alpha: if a check fails, fix it directly instead of adding compatibility shims.

## Local Gates

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run bundle:budget
npm run lint
npm run db:verify
npm run eval:smoke
npm run security:secrets
npm run security:audit
npm run bootstrap:fresh-check
```

## Browser QA

1. Start deterministic local services:

```bash
npm run qa:mock-api
npm run dev -w @uiuc-course-search/web -- --host 127.0.0.1 --port 5173
```

2. Use Browser to verify desktop and mobile:

- Search success with match evidence.
- Empty result state.
- API error state with no console errors.
- Course detail page.
- Sections table overflow on mobile.

3. Save screenshots under `artifacts/browser-qa/`.

## Staging Gates

These require valid Cloudflare auth through Wrangler or `CLOUDFLARE_API_TOKEN`/account env vars.

```bash
npx wrangler whoami
D1_BACKUP_REF=<YYYYMMDDTHHMMSSZ> \
D1_BACKUP_EVIDENCE_FILE=artifacts/d1-backup-evidence.md \
STAGING_MIGRATION_APPROVED=<latest-migration-name> \
STAGING_MIGRATION_SHA256_APPROVED=<reviewed-lowercase-sha256> \
STAGING_API_BASE_URL=https://<staging-worker-host> \
STAGING_ADMIN_TOKEN=<redacted> \
npm run deploy:api:staging
VITE_API_BASE_URL=https://<staging-worker-host> npm run deploy:web:staging
STAGING_API_BASE_URL=https://<staging-worker-host> STAGING_WEB_ORIGIN=https://<staging-pages-host> STAGING_ADMIN_TOKEN=<redacted> STAGING_INTERNAL_TOKEN=<redacted> npm run test:staging
EVAL_BASE_URL=https://<staging-worker-host> npm run eval:staging
npm run cloudflare:preflight
```

The API release applies D1 migrations before the new Worker is published, then
republishes every active/registrable course snapshot in bounded five-subject
pages. A separate finalizer refetches the authoritative manifest, matches its
SHA-256 to the exact paged subject set, rejects stale checkpoints or implausible
destructive shrinkage, and only then records term freshness. The release then
imports the complete GPA dataset and rebuilds GPA aggregates, the RMP cache,
instructor links, and public scores. The GPA import is capped at 1,024 chunk requests and
fails on an unsuccessful, invalid, or non-progressing response; GPA aggregation
does not begin until the importer reports completion with a durable completion
key. If any migration, deploy, rebuild, or status check fails, stop and use the
recorded Time Travel bookmark; do not publish the web build against a partially
released API.

Review the latest SQL migration itself, compute its SHA-256 with
`shasum -a 256 apps/api/migrations/<latest-migration-name>.sql`, and paste the
literal filename and digest into the two approval variables. The release gate
checks both against the current checkout so a reviewed filename cannot approve
later-edited SQL.

Do not paste or commit token values. Record only token names and command exit status in the final report.

## Production Release

Production is a separate, fail-closed release, not a staging command with
different environment values. Its fixed targets are Worker
`uiuc-course-search`, API
`https://uiuc-course-search.lumirth.workers.dev`, D1
`course-search-db-v2`, and Pages project `uiuc-course-search-web` branch
`main`.

The legacy `course-search-db` is rollback-only by release policy because it
exceeds the free-plan per-database size limit. The release gate reads the
production `DB` binding from
`apps/api/wrangler.toml` and rejects the legacy database or any unreviewed
replacement name.

Verify Wrangler identity and required production secret names, then create and
restore-test a fresh backup of `course-search-db-v2`. Use production-specific
evidence and approvals:

```bash
npx wrangler whoami
npx wrangler secret list --name uiuc-course-search
PRODUCTION_D1_BACKUP_REF=<YYYYMMDDTHHMMSSZ> \
PRODUCTION_D1_BACKUP_EVIDENCE_FILE=artifacts/production-d1-backup-evidence.md \
PRODUCTION_MIGRATION_APPROVED=<latest-migration-name> \
PRODUCTION_MIGRATION_SHA256_APPROVED=<reviewed-lowercase-sha256> \
PRODUCTION_API_BASE_URL=https://uiuc-course-search.lumirth.workers.dev \
PRODUCTION_ADMIN_TOKEN=<redacted> \
npm run deploy:production
```

`PRODUCTION_ADMIN_TOKEN` must match the production Worker’s `ADMIN_TOKEN`
secret. Never paste the value into documentation or commit it. The top-level
command serializes `deploy:api:production` before `deploy:web:production`; the
web phase therefore cannot publish if migration, Worker deployment, data
rebuild, or post-release API verification fails. The web build pins
`VITE_API_BASE_URL` to the official Worker and publishes Pages project
`uiuc-course-search-web` branch `main`.

Record deployment target evidence with these labels before the final preflight:

```text
Staging API URL: https://<staging-worker-host>
Staging Web URL: https://<staging-pages-host>
Pages Project: uiuc-course-search-web
Pages Branch: staging
```

## Public Abuse Controls

Before a public demo, configure Cloudflare Workers Rate Limiting bindings or equivalent WAF rules for:

- `GET /api/search*`: start at 120 requests/minute/IP.
- `GET /api/course/*`: start at 240 requests/minute/IP.
- `POST /api/feedback`: start at 20 requests/minute/IP and require an exact configured frontend origin.

Record the rule IDs, expressions, thresholds, action, and observed dashboard state in the final report. Use these labels so `npm run cloudflare:preflight` can verify the control shape:

```text
Rate-Limit Namespace IDs: SEARCH_RATE_LIMITER=<integer>, COURSE_RATE_LIMITER=<integer>, FEEDBACK_RATE_LIMITER=<integer>
Abuse Control Routes: /api/search*, /api/course/*, /api/feedback
Abuse Control Action: Worker Rate Limiting returns 429 JSON block response before public route handlers
Abuse Control Thresholds: /api/search*=120 requests/min/IP, /api/course/*=240 requests/min/IP, /api/feedback=20 requests/min/IP
```

## Data Safety

Create and restore-test a staging D1 Time Travel backup before destructive D1 work:

```bash
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
npx wrangler d1 time-travel info course-search-db-staging --json
npx wrangler d1 execute course-search-db-staging --remote --command "INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('restore-test-$BACKUP_REF', 'marker', unixepoch())"
npx wrangler d1 time-travel restore course-search-db-staging --bookmark <bookmark-from-info>
npx wrangler d1 execute course-search-db-staging --remote --command "SELECT COUNT(*) AS marker_count FROM app_meta WHERE key = 'restore-test-$BACKUP_REF'"
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file artifacts/d1-backup-evidence.md --restore-verified
npm run cloudflare:preflight
```

Record the D1 evidence with these labels before running the final Cloudflare preflight:

```text
D1 Backup Ref: <YYYYMMDDTHHMMSSZ>
D1 Backup Mechanism: Cloudflare D1 Time Travel
D1 Backup Location: Cloudflare D1 Time Travel bookmark <bookmark> for ref <YYYYMMDDTHHMMSSZ>
D1 Restore Database: course-search-db-staging
D1 Restore Verified: yes
```
