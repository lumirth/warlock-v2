# Pre-Alpha Release Checklist

Date: 2026-06-01

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
npm run deploy:api:staging
VITE_API_BASE_URL=https://<staging-worker-host> npm run deploy:web:staging
STAGING_API_BASE_URL=https://<staging-worker-host> STAGING_ADMIN_TOKEN=<redacted> STAGING_INTERNAL_TOKEN=<redacted> npm run test:staging
EVAL_BASE_URL=https://<staging-worker-host> npm run eval:staging
npm run cloudflare:preflight
```

Do not paste or commit token values. Record only token names and command exit status in the final report.

Record deployment target evidence with these labels before the final preflight:

```text
Staging API URL: https://<staging-worker-host>
Staging Web URL: https://<staging-pages-host>
Pages Project: uiuc-course-search-web
Pages Branch: staging
```

## Public Abuse Controls

Before a public demo, configure Cloudflare rate limiting or WAF rules for:

- `GET /api/search*`: start at 60 requests/minute/IP.
- `GET /api/course/*`: start at 120 requests/minute/IP.

Record the rule IDs, expressions, thresholds, action, and observed dashboard state in the final report. Use these labels so `npm run cloudflare:preflight` can verify the control shape:

```text
WAF Rule ID: <uuid>
Abuse Control Routes: /api/search*, /api/course/*
Abuse Control Action: block-or-managed_challenge
Abuse Control Thresholds: /api/search*=60/min/IP, /api/course/*=120/min/IP
```

## Data Safety

Create and restore-test a staging D1 export before destructive D1 work:

```bash
mkdir -p artifacts/d1-backups
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
npx wrangler d1 export course-search-db-staging --remote --output artifacts/d1-backups/course-search-db-staging-$BACKUP_REF.sql -y
npx wrangler d1 create course-search-db-staging-restore-$BACKUP_REF
npx wrangler d1 execute course-search-db-staging-restore-$BACKUP_REF --remote --file artifacts/d1-backups/course-search-db-staging-$BACKUP_REF.sql
npx wrangler d1 execute course-search-db-staging-restore-$BACKUP_REF --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file docs/reports/2026-06-01-stabilization-report.md --restore-verified
npm run cloudflare:preflight
```

Record the D1 evidence with these labels before running the final Cloudflare preflight:

```text
D1 Backup Ref: <YYYYMMDDTHHMMSSZ>
D1 Backup Location: artifacts/d1-backups/course-search-db-staging-<YYYYMMDDTHHMMSSZ>.sql
D1 Restore Database: course-search-db-staging-restore-<YYYYMMDDTHHMMSSZ>
D1 Restore Verified: yes
```
