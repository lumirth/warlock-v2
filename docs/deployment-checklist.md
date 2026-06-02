# Deployment Checklist

This project is pre-alpha, so deployment should stay small and explicit. Do not expose a public worker until these checks are true for the target environment.

## Route Classes

- Public: `/`, `/health`, `/api/search`, `/api/course/:subject/:number`, `/api/feedback`.
- Admin: `/admin/*`. Requires `Authorization: Bearer $ADMIN_TOKEN`.
- Internal: `/internal/*`. Requires `Authorization: Bearer $INTERNAL_TOKEN`.
- Admin diagnostics: `/admin/debug/subjects/:year/:term`. Requires admin auth and must not include arbitrary URL fetch tools or raw database dumps.

## Required Secrets

- `ADMIN_TOKEN`: required for `/admin/*` callers.
- `INTERNAL_TOKEN`: required for service-binding fan-out to `/internal/*`.
- `RMP_AUTH_TOKEN`: required only if RMP sync is enabled.

Document secret names only. Never commit or paste values into docs, reports, CI logs, or Browser-visible forms.

## Public Abuse Controls

The in-app `UpstreamBackoff` only protects upstream sources such as CISAPI after 429/503 responses. It is not a public caller rate limit.

Before a public demo deployment, configure Cloudflare Workers Rate Limiting bindings or equivalent zone WAF/rate limiting for public read endpoints:

- Match `/api/search*` and `/api/course/*`.
- Start with 120 requests per minute per IP for `/api/search*`.
- Start with 240 requests per minute per IP for `/api/course/*`.
- Put `/api/feedback` behind the public search limiter class until a separate feedback limiter exists.
- Use a lower threshold for repeated 4xx/5xx responses if Cloudflare rules allow it.
- Leave `/admin/*` and `/internal/*` protected by token auth regardless of WAF settings.

Record namespace IDs or rule IDs, expressions, thresholds, action, and deploy/dashboard evidence in the stabilization report. `npm run cloudflare:preflight` requires `Rate-Limit Namespace IDs`, `WAF Rule ID`, or `Rate-Limit Rule ID`, plus `Abuse Control Routes`, `Abuse Control Action`, and `Abuse Control Thresholds`. See `docs/cloudflare-hardening-runbook.md`.

## Database Bootstrap

Use the canonical baseline in `apps/api/migrations/0001_initial_schema.sql`. It must remain byte-for-byte identical to `apps/api/src/db/schema.sql`.

Run before deployment:

```bash
npm run db:verify
```

Run all local release gates before staging:

```bash
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

## Search Logging

Normal production search must not print raw SQL, SQL params, or raw query analytics. Add analytics later through an explicit privacy-reviewed model rather than ad hoc request logging.

## D1 Backups

Before destructive remote D1 operations, create a backup using the current Cloudflare-supported mechanism, verify that it is restorable, and record the target database, timestamp, and backup location before proceeding. For this FTS-backed schema, use Cloudflare D1 Time Travel because SQL export refuses databases with virtual tables.

Minimum command shape:

```bash
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
npx wrangler d1 time-travel info course-search-db-staging --json
npx wrangler d1 execute course-search-db-staging --remote --command "INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('restore-test-$BACKUP_REF', 'marker', unixepoch())"
npx wrangler d1 time-travel restore course-search-db-staging --bookmark <bookmark-from-info>
npx wrangler d1 execute course-search-db-staging --remote --command "SELECT COUNT(*) AS marker_count FROM app_meta WHERE key = 'restore-test-$BACKUP_REF'"
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file docs/reports/2026-06-01-stabilization-report.md --restore-verified
```

Record the report markers exactly:

```text
D1 Backup Ref: <YYYYMMDDTHHMMSSZ>
D1 Backup Mechanism: Cloudflare D1 Time Travel
D1 Backup Location: Cloudflare D1 Time Travel bookmark <bookmark> for ref <YYYYMMDDTHHMMSSZ>
D1 Restore Database: course-search-db-staging
D1 Restore Verified: yes
```

## Staging Smoke

Required environment variables:

- `STAGING_API_BASE_URL`
- `STAGING_ADMIN_TOKEN`
- `STAGING_INTERNAL_TOKEN`
- `EVAL_BASE_URL`

Commands:

```bash
npm run test:staging
npm run eval:staging
npm run cloudflare:preflight
```

The stabilization report must include `Staging API URL`, `Staging Web URL`, `Pages Project: uiuc-course-search-web`, and `Pages Branch: staging` before `npm run cloudflare:preflight` can pass.

## Data Freshness

Before a public demo or semester refresh, inspect:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync/status"
```

The response must include `freshness.currentTermPresent`, `freshness.activeTermIds`, `freshness.upcomingTermIds`, `freshness.historicalTermCount`, `freshness.staleTermIds`, and `freshness.staleSyncStateIds`. Follow `docs/data-refresh-runbook.md` when any required source is stale.

Cloudflare auth status on 2026-06-01: Wrangler OAuth is authenticated locally; do not commit token cache files or secret values.
