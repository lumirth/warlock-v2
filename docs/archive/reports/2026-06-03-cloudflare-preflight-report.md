# Cloudflare Preflight Report

Date: 2026-06-03

Scope: close the remaining environment-token gap in the Cloudflare staging preflight and prove staging auth/search/course/eval still work after rotating staging operator tokens. The project is pre-alpha/no-users/greenfield, so rotating staging admin/internal tokens is an acceptable sharp cutover.

## Auth Rotation

Staging `ADMIN_TOKEN` and `INTERNAL_TOKEN` were rotated with `wrangler secret put`. The secret values were not printed, committed, or stored in any report.

Evidence:

- Rotation metadata: `artifacts/backups/20260603T021409Z-staging-auth-rotation/metadata.md`
- Pre-rotation secret-name list: `artifacts/backups/20260603T021409Z-staging-auth-rotation/secrets-before.txt`
- Post-rotation secret-name list: `artifacts/backups/20260603T021409Z-staging-auth-rotation/secrets-after.txt`
- Local temp token file mode evidence: `artifacts/backups/20260603T021409Z-staging-auth-rotation/token-file-modes.txt`

The post-rotation secret-name list contains `ADMIN_TOKEN`, `INTERNAL_TOKEN`, and `RMP_AUTH_TOKEN`.

## Live Staging Smoke

Command shape:

```bash
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev \
STAGING_ADMIN_TOKEN=<redacted> \
STAGING_INTERNAL_TOKEN=<redacted> \
npm run test:staging
```

Result: 10 checks, 10 passing, 0 failed.

Evidence:

- `artifacts/staging-smoke-report.md`
- `artifacts/staging-smoke-results.json`

Covered checks:

- Health route.
- Public search route.
- Professor search route.
- Public course route.
- Public feedback route.
- Missing admin token rejection.
- Valid staging admin token acceptance.
- Authenticated `/admin/sync/status`.
- Missing internal token rejection.
- Valid staging internal token boundary.

## Live Staging Eval

Command shape:

```bash
EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev npm run eval:staging
```

Result: 100 queries, 100 passing, 0 failed, 0 violations, 0 missing expected top results.

The run included the previously reported intuitive-query classes:

- `intro to CS`
- `intro to comp sci`
- `intro computer science`
- `philosophy`
- typo variants such as `philosphy`, `computr science`, and `artifical inteligence`
- professor variants such as `professor fagen`, `prof fagen-ulmschneider`, and `taught by wade fagen algorithms`

## Cloudflare Staging Preflight

Command shape:

```bash
STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev \
STAGING_ADMIN_TOKEN=<redacted> \
STAGING_INTERNAL_TOKEN=<redacted> \
EVAL_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev \
npm run cloudflare:preflight
```

Result: 32 checks, 32 passing, 0 failed.

The preflight validated:

- Wrangler auth.
- Staging Worker name and `[env.staging]` config.
- D1, KV, Vectorize, AI, SELF, and rate-limit bindings.
- Required staging environment variables.
- Staging smoke artifact.
- Staging API and Pages URL evidence.
- Pages project and branch evidence.
- Worker rate-limit namespace, route, action, and threshold evidence.
- D1 backup ref, backup location, restore target, and `D1 Restore Verified: yes` evidence.
