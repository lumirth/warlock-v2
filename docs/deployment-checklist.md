# Deployment Checklist

This project is pre-alpha, so deployment should stay small and explicit. Do not expose a public worker until these checks are true for the target environment.

## Route Classes

- Public: `/`, `/health`, `/api/search`, `/api/course/:subject/:number`.
- Admin: `/admin/*`. Requires `Authorization: Bearer $ADMIN_TOKEN`.
- Internal: `/internal/*`. Requires `Authorization: Bearer $INTERNAL_TOKEN`.
- Dev diagnostics: `/admin/debug/*`. Requires admin auth and must not include arbitrary URL fetch tools.

## Required Secrets

- `ADMIN_TOKEN`: required for `/admin/*` callers.
- `INTERNAL_TOKEN`: required for service-binding fan-out to `/internal/*`.
- `RMP_AUTH_TOKEN`: required only if RMP sync is enabled.

Document secret names only. Never commit or paste values into docs, reports, CI logs, or Browser-visible forms.

## Public Abuse Controls

The in-app `UpstreamBackoff` only protects upstream sources such as CISAPI after 429/503 responses. It is not a public caller rate limit.

Before a public demo deployment, configure Cloudflare WAF or route-level rate limiting for public read endpoints:

- Match `/api/search*` and `/api/course/*`.
- Start with a conservative threshold such as 60 requests per minute per IP for `/api/search*`.
- Start with 120 requests per minute per IP for `/api/course/*`.
- Use a lower threshold for repeated 4xx/5xx responses if Cloudflare rules allow it.
- Leave `/admin/*` and `/internal/*` protected by token auth regardless of WAF settings.

Record rule IDs, expressions, thresholds, action, and dashboard evidence in the stabilization report. `npm run cloudflare:preflight` requires `WAF Rule ID` or `Rate-Limit Rule ID`, plus `Abuse Control Routes`, `Abuse Control Action`, and `Abuse Control Thresholds`. See `docs/cloudflare-hardening-runbook.md`.

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

Before destructive remote D1 operations, create an export/backup using the current Cloudflare-supported mechanism, verify that it is restorable, and record the target database, timestamp, and backup location before proceeding.

Minimum command shape:

```bash
mkdir -p artifacts/d1-backups
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
npx wrangler d1 export course-search-db-staging --remote --output artifacts/d1-backups/course-search-db-staging-$BACKUP_REF.sql -y
npx wrangler d1 create course-search-db-staging-restore-$BACKUP_REF
npx wrangler d1 execute course-search-db-staging-restore-$BACKUP_REF --remote --file artifacts/d1-backups/course-search-db-staging-$BACKUP_REF.sql
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file docs/reports/2026-06-01-stabilization-report.md --restore-verified
```

Record the report markers exactly:

```text
D1 Backup Ref: <YYYYMMDDTHHMMSSZ>
D1 Backup Location: artifacts/d1-backups/course-search-db-staging-<YYYYMMDDTHHMMSSZ>.sql
D1 Restore Database: course-search-db-staging-restore-<YYYYMMDDTHHMMSSZ>
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

Cloudflare auth status on 2026-06-01: local `npx wrangler whoami` failed with `Not logged in`, and no Cloudflare token/account env vars were present. Staging deployment, WAF verification, and remote D1 restore testing require valid Cloudflare auth before they can be completed.
