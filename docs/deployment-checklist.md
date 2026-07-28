# Deployment Checklist

This project is pre-alpha, so deployment should stay small and explicit. Do not expose a public worker until these checks are true for the target environment.

## Route Classes

- Public reads: `/`, `/health`, `/api/search`, `/api/course/:subject/:number`, `/api/terms`.
- Public write: `POST /api/feedback`, restricted to `FEEDBACK_ALLOWED_ORIGINS`.
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
- Apply `FEEDBACK_RATE_LIMITER` at 20 requests per minute per IP to `/api/feedback`.
- Configure `FEEDBACK_ALLOWED_ORIGINS` with exact deployed frontend origins.
- Use a lower threshold for repeated 4xx/5xx responses if Cloudflare rules allow it.
- Leave `/admin/*` and `/internal/*` protected by token auth regardless of WAF settings.

Record namespace IDs or rule IDs, expressions, thresholds, action, and deploy/dashboard evidence in the evidence file passed to `npm run cloudflare:preflight`. The preflight requires `Rate-Limit Namespace IDs`, `WAF Rule ID`, or `Rate-Limit Rule ID`, plus `Abuse Control Routes`, `Abuse Control Action`, and `Abuse Control Thresholds`. See `docs/cloudflare-hardening-runbook.md`.

## Database Bootstrap

`apps/api/migrations/` is the ordered, immutable upgrade path for existing D1 databases.
`apps/api/src/db/schema.sql` is the current-state bootstrap for a brand-new database.
Never rewrite an applied migration to make it resemble the current schema. Add the next
numbered migration and update the bootstrap schema in the same change.

Run before deployment:

```bash
npm run db:verify
```

Existing staging databases must be upgraded through the fail-closed API release
command. A plain `wrangler deploy` is not a valid release: Worker code may
require the newest schema, and migrations may invalidate regenerable
enrichment. The release command refuses to continue without restore-tested D1
backup evidence and explicit approval of the current migration. It then runs
the API gates, applies remote migrations, deploys the Worker, republishes every
active/registrable course snapshot, imports the complete GPA dataset, rebuilds
GPA/RMP enrichment, and verifies sync status:

```bash
D1_BACKUP_REF=<YYYYMMDDTHHMMSSZ> \
D1_BACKUP_EVIDENCE_FILE=artifacts/d1-backup-evidence.md \
STAGING_MIGRATION_APPROVED=<latest-migration-name> \
STAGING_MIGRATION_SHA256_APPROVED=<reviewed-lowercase-sha256> \
STAGING_API_BASE_URL=https://<staging-worker-host> \
STAGING_ADMIN_TOKEN=<redacted> \
npm run deploy:api:staging
```

After reviewing the latest migration, compute its digest with
`shasum -a 256 apps/api/migrations/<latest-migration-name>.sql` and supply the
literal lowercase SHA-256. Do not derive the approval variables inline in the
deploy command: they are the operator's acknowledgement of the exact SQL
contents, not merely a checksum lookup.

Do not run the web deploy concurrently with this operation. The top-level
`npm run deploy:staging` deliberately waits for the API migration, deploy, and
data rebuild to finish before publishing the web build.

## Official Production Release

The official targets are deliberately fixed:

- Worker: `uiuc-course-search`
- API origin: `https://uiuc-course-search.lumirth.workers.dev`
- D1 binding: `course-search-db-v2`
- Pages project: `uiuc-course-search-web`
- Pages production branch: `main`
- Pages origin: `https://uiuc-course-search-web.pages.dev`

The legacy `course-search-db` database is over the free-plan per-database size
limit and is rollback-only by release policy. Do not migrate, delete, rename,
or rebind it during a release.
The production release reads the `DB` binding from `apps/api/wrangler.toml` and
fails unless it is the allowlisted replacement `course-search-db-v2`.

Confirm Wrangler authentication, the production account, and required Worker
secret names before releasing. `wrangler secret list` reveals names, not secret
values; set or rotate values through `wrangler secret put` without writing them
to the repository or shell history.

After reviewing the latest migration and restore-testing a fresh Time Travel
backup of `course-search-db-v2`, run:

```bash
PRODUCTION_D1_BACKUP_REF=<YYYYMMDDTHHMMSSZ> \
PRODUCTION_D1_BACKUP_EVIDENCE_FILE=artifacts/production-d1-backup-evidence.md \
PRODUCTION_MIGRATION_APPROVED=<latest-migration-name> \
PRODUCTION_MIGRATION_SHA256_APPROVED=<reviewed-lowercase-sha256> \
PRODUCTION_API_BASE_URL=https://uiuc-course-search.lumirth.workers.dev \
PRODUCTION_ADMIN_TOKEN=<redacted> \
npm run deploy:production
```

The production variables are intentionally distinct from staging. Generic
`D1_BACKUP_REF`, staging approvals, and staging tokens cannot authorize this
release. `npm run deploy:production` runs the guarded API migration, Worker
deployment, full data rebuild, and post-release status checks before it builds
and publishes the web app. GPA import calls are bounded at 1,024 chunks and
must report successful forward progress until a durable completion key is
returned; aggregation never runs after an unsuccessful, invalid, stalled, or
incomplete import. If the API phase fails, the Pages command does not run.

The web command always builds with
`VITE_API_BASE_URL=https://uiuc-course-search.lumirth.workers.dev` and deploys
only to project `uiuc-course-search-web` on branch `main`. Do not substitute a
preview deployment URL as the production API or web origin.

Run all local release gates before any release:

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

## Vectorize Metadata

Semantic search pre-filters by subject, course level, and term before Vectorize selects its top matches. Create all three metadata indexes for every Vectorize environment:

```bash
cd apps/api
npx wrangler vectorize create-metadata-index course-embeddings --propertyName subject --type string
npx wrangler vectorize create-metadata-index course-embeddings --propertyName level_bucket --type number
npx wrangler vectorize create-metadata-index course-embeddings --propertyName term_id --type string

npx wrangler vectorize create-metadata-index course-embeddings-staging --propertyName subject --type string
npx wrangler vectorize create-metadata-index course-embeddings-staging --propertyName level_bucket --type number
npx wrangler vectorize create-metadata-index course-embeddings-staging --propertyName term_id --type string
```

After adding or changing embedding metadata, rebuild embeddings before accepting semantic-search smoke results. Old vectors without `term_id` cannot participate in active-scope semantic recall.

Backfill each page until the response reports `"hasMore": false`:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$STAGING_API_BASE_URL/admin/embeddings/backfill?scope=all&limit=250&offset=0"
```

Increase `offset` by `processed` for each subsequent request.

## D1 Backups

Before every remote migration or other destructive D1 operation, create a
backup using the current Cloudflare-supported mechanism, verify that it is
restorable, and record the target database, timestamp, and backup location
before proceeding. For this FTS-backed schema, use Cloudflare D1 Time Travel
because SQL export refuses databases with virtual tables.

Minimum command shape:

```bash
BACKUP_REF=$(date -u +%Y%m%dT%H%M%SZ)
npx wrangler d1 time-travel info course-search-db-staging --json
npx wrangler d1 execute course-search-db-staging --remote --command "INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('restore-test-$BACKUP_REF', 'marker', unixepoch())"
npx wrangler d1 time-travel restore course-search-db-staging --bookmark <bookmark-from-info>
npx wrangler d1 execute course-search-db-staging --remote --command "SELECT COUNT(*) AS marker_count FROM app_meta WHERE key = 'restore-test-$BACKUP_REF'"
npm run d1:preflight -- --database course-search-db-staging --backup-ref "$BACKUP_REF" --evidence-file artifacts/d1-backup-evidence.md --restore-verified
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
- `STAGING_WEB_ORIGIN`
- `EVAL_BASE_URL`

Commands:

```bash
npm run test:staging
npm run eval:staging
npm run cloudflare:preflight
```

The evidence file passed to `npm run cloudflare:preflight` must include `Staging API URL`, `Staging Web URL`, `Pages Project: uiuc-course-search-web`, and `Pages Branch: staging`.

## Data Freshness

Before a public demo or semester refresh, inspect:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$STAGING_API_BASE_URL/admin/sync/status"
```

The response must include `freshness.currentTermPresent`, `freshness.activeTermIds`, `freshness.upcomingTermIds`, `freshness.historicalTermCount`, `freshness.staleTermIds`, and `freshness.staleSyncStateIds`. Follow `docs/data-refresh-runbook.md` when any required source is stale.

## Required Staging Evidence

Create a fresh evidence file under `artifacts/` for every release. It must identify the deployed Worker and Pages targets, current deploy version, D1 database, abuse-control configuration, freshness audit, destructive-action backup when applicable, staging smoke result, staging eval result, and Cloudflare preflight result. Never treat a previous release's evidence as current.
