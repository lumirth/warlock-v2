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

## Public Abuse Controls

The in-app `UpstreamBackoff` only protects upstream sources such as CISAPI after 429/503 responses. It is not a public caller rate limit.

Before a public demo deployment, configure Cloudflare WAF or route-level rate limiting for public read endpoints:

- Match `/api/search*` and `/api/course/*`.
- Start with a conservative threshold such as 60 requests per minute per IP for `/api/search*`.
- Use a lower threshold for repeated 4xx/5xx responses if Cloudflare rules allow it.
- Leave `/admin/*` and `/internal/*` protected by token auth regardless of WAF settings.

## Database Bootstrap

Use the canonical baseline in `apps/api/migrations/0001_initial_schema.sql`. It must remain byte-for-byte identical to `apps/api/src/db/schema.sql`.

Run before deployment:

```bash
npm run db:verify
```

## Search Logging

Normal production search must not print raw SQL, SQL params, or raw query analytics. Add analytics later through an explicit privacy-reviewed model rather than ad hoc request logging.

## D1 Backups

Before destructive remote D1 operations, create an export/backup using the current Cloudflare-supported mechanism, verify that it is restorable, and record the target database, timestamp, and backup location before proceeding.
