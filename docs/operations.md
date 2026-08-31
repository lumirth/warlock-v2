# Operations

The repository keeps operational policy at executable boundaries. Cloudflare,
the deployed Worker, and D1 are evidence; copied route inventories and prose
reports are not.

## Local gate

Use Node 22 and the lockfile:

```bash
npm ci
npm run build
npm test
npm run lint
npm run bundle:budget
npm run security:secrets
npm audit --audit-level=high
```

`npm run build` already compiles every workspace and produces the web bundle.
The API integration suite applies the canonical migration to a real local D1
database. There is no second bootstrap schema or generated schema verifier.
The single migration is intentionally clean-slate: recreate the pre-alpha D1
database and update its `database_id` binding after schema changes instead of
carrying upgrade compatibility. The release command rejects an old schema;
readiness requires a completely synchronized active term with stored courses.

## Worker release

The full-catalog refresh requires Workers Paid; one subject batch intentionally exceeds the Free plan's D1 query limit.

Create a fresh D1 database, put its ID in the target binding, and keep the old
database intact. The API release applies the clean schema, rejects a stale
schema, deploys with strict configuration checks, bootstraps an empty catalog
and GPA dataset, and requires a fully published active term.

```bash
export STAGING_ADMIN_TOKEN=<secret>
npm run deploy:api:staging
```

For production, use `PRODUCTION_ADMIN_TOKEN` and `npm run deploy:api:production`. Wrangler's
`--strict` deployment mode rejects conflicting remote configuration.

Deploy the web application only after the API gate succeeds:

```bash
npm run deploy:web:staging
# or
npm run deploy:web:production
```

## Live verification

The staging smoke command exercises the actual health, search, course,
feedback, admin-auth, internal-auth, and sync-status boundaries:

```bash
export STAGING_API_BASE_URL=https://uiuc-course-search-staging.lumirth.workers.dev
export STAGING_WEB_ORIGIN=https://staging.uiuc-course-search-web.pages.dev
export STAGING_ADMIN_TOKEN=<secret>
export STAGING_INTERNAL_TOKEN=<secret>
npm run test:staging
```

Then run the compact public-search behavior corpus against the same deployment:

```bash
EVAL_BASE_URL="$STAGING_API_BASE_URL" npm run eval:staging
```

## Data refresh

Scheduled Worker workflows are the normal refresh mechanism. Operators should
use the same Worker application boundary for an exceptional manual run:

```bash
AUTH="Authorization: Bearer $ADMIN_TOKEN"
curl -fsS -X POST -H "$AUTH" "$API/admin/discover-terms"
curl -fsS -X POST -H "$AUTH" "$API/admin/sync"
curl -fsS -X DELETE -H "$AUTH" "$API/admin/gpa"
curl -fsS -X POST -H "$AUTH" "$API/admin/gpa" # repeat until isComplete
curl -fsS -X POST -H "$AUTH" "$API/admin/enrich"
curl -fsS -H "$AUTH" "$API/admin/sync/status"
```

`DELETE /admin/gpa` starts a staged GPA generation without removing the
currently published one. Each `POST /admin/gpa` imports one bounded chunk; the
final call atomically replaces GPA statistics, rebuilds derived links/scores,
and reports `isComplete`. `/admin/enrich` refreshes RMP data and rebuilds links
and scores from the published GPA generation.

Do not maintain a second client-side pagination, retry, retention, or release
state machine. The Worker owns those policies and returns the authoritative
status.

## Feedback inspection

Feedback remains ordinary D1 data. Inspect it directly rather than exporting it
through a second schema and classification pipeline:

```bash
npx wrangler d1 execute DB --remote \
  --config apps/api/wrangler.toml \
  --command 'SELECT id, page, query, message, created_at FROM feedback_events ORDER BY created_at DESC LIMIT 100'
```

When a report exposes a missing search behavior, add the smallest reproducer to
the owning unit test or to `apps/api/src/eval/scenarios.ts` when it is a deployed
public-contract promise.

## Rollback

Stop on the first failed release or smoke gate. Roll the Worker back using
Cloudflare's version history and restore the previous D1 binding ID from Git.
The clean-slate release never mutates that database. Re-run health, staging
smoke, and public eval after rollback.
