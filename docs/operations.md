# Operations

Run the [local gate](../README.md#verify-changes) before deployment. Use the
committed lockfile and keep the tested source revision available for rollback.
The hosted release consists of a Worker, its D1/KV bindings, and the web assets
in `apps/web/dist`.

## Environments and resources

| Environment | API | Web | Wrangler environment |
| --- | --- | --- | --- |
| Staging | `https://warlock-staging.lumirth.workers.dev` | `https://staging.course-warlock.pages.dev` | `--env staging` |
| Production | `https://warlock.lumirth.workers.dev` | `https://course-warlock.pages.dev` | Default |

Staging has no cron triggers. Production discovers terms twice daily, advances
the catalog every 15 minutes, starts weekly enrichment, and advances GPA imports
every five minutes. Cron expressions in `apps/api/wrangler.toml` use UTC.

The databases retain their original `uiuc-course-search-db-production` and
`uiuc-course-search-db-staging` names and binding IDs. They contain the existing
catalog, ratings, and feedback; the application rename does not replace them.

Full-catalog refresh requires Workers Paid because subject batches exceed the
Free plan's D1 query limit. Authenticate Wrangler with `npx wrangler login` or
the account's configured API credentials before deploying.

The checked-in bindings belong to this deployment. For a new Cloudflare account,
create separate D1 databases and GPA-cache KV namespaces for staging and
production. Cloudflare's [D1 setup](https://developers.cloudflare.com/d1/get-started/)
and [KV setup](https://developers.cloudflare.com/kv/get-started/) explain the
resource commands. Update the names and IDs in both sets of bindings in
`apps/api/wrangler.toml`.

The existing Pages project is `course-warlock`, with production branch `main`.
For another installation, create a
[Direct Upload project](https://developers.cloudflare.com/pages/get-started/direct-upload/)
and set its production branch to `main` before deploying.

If you change deployment names, update the Worker names, Pages project and API
URLs in `apps/web/package.json`, the default API URL in
`apps/web/src/lib/api-client.ts`, and the defaults in `scripts/release-api.ts`
and `scripts/smoke.ts`. Set `FEEDBACK_ALLOWED_ORIGINS` to each web deployment's
actual origin. These are comma-separated origins; preview URLs need explicit
permission to submit feedback.

## Secrets

Set `ADMIN_TOKEN` separately on each Worker. The release and smoke commands
need the matching token in the operator's environment as `STAGING_ADMIN_TOKEN`
or `PRODUCTION_ADMIN_TOKEN`. They do not install the Worker secret.

```bash
npx wrangler secret put ADMIN_TOKEN --config apps/api/wrangler.toml --env staging
npx wrangler secret put ADMIN_TOKEN --config apps/api/wrangler.toml
```

Set `RMP_AUTH_TOKEN` the same way when enabling instructor-rating enrichment.
Catalog loading and GPA imports do not require that token. `/admin/enrich` and
the weekly ratings refresh do require it. Store secrets in your credential
manager rather than repository files.

## Release staging

Set `STAGING_ADMIN_TOKEN` to the staging Worker's credential, then run:

```bash
npm run deploy:api:staging
```

The API command validates its target and local credential before running
Wrangler. It applies migrations, probes the schema, deploys with `--strict`,
discovers terms, and calls bounded catalog steps until every current term is
complete. It then imports GPA data and checks that the root endpoint exposes
a populated current term. Strict deployment rejects conflicting remote
configuration.

If a release stops, inspect the reported failure and rerun the command after
correcting it. Catalog progress and in-progress GPA imports remain in D1.
Completed imports are reused. A transport timeout can leave a subject or GPA
lease running; wait for its expiry before retrying if status reports it busy.
The command limits catalog loading to 64 steps and GPA loading to 64 chunks.

`STAGING_API_BASE_URL` can override the API URL the release command calls. It
must identify the Worker Wrangler deploys. An override changes neither the
deployment target nor the web bundle's API URL.

After the API gate succeeds:

```bash
npm run deploy:web:staging
npm run test:staging
EVAL_BASE_URL=https://warlock-staging.lumirth.workers.dev npm run eval:staging
```

The web command builds with the staging API URL and uploads `dist` to the
Pages staging branch. The smoke command checks readiness, a populated search,
course details, feedback validation, and admin authentication/status. It sends
invalid feedback only, so it does not create a feedback record.

Open the staging web URL and exercise search, filter removal, advanced search,
the table view, a course page, and the return link. Check keyboard navigation,
a narrow layout, and both themes. API smoke and public eval do not verify the
rendered client.

## Release production

Use the staging-tested revision. Set `PRODUCTION_ADMIN_TOKEN`, then run:

```bash
npm run deploy:api:production
npm run deploy:web:production
npm run test:production
EVAL_BASE_URL=https://warlock.lumirth.workers.dev npm run eval:staging
```

The public eval command uses `EVAL_BASE_URL` despite its `eval:staging` name.
`PRODUCTION_API_BASE_URL` and `PRODUCTION_WEB_ORIGIN` override production smoke
defaults. Staging uses the corresponding `STAGING_` variables. Smoke chooses a
published current term from the API root; `SMOKE_SUBJECT`, `SMOKE_NUMBER`,
`SMOKE_TERM`, and `SMOKE_YEAR` select another known offering when needed.

Record the source revision, Worker version, and Pages deployment URL returned
by Wrangler. Repeat the browser workflow on the production URL and confirm its
requests use the production Worker.

## Refresh data

Production cron triggers normally own refreshes. For manual recovery, set `API`
and `ADMIN_TOKEN` for the intended environment:

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/discover-terms"
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/sync"
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/sync/status"
```

Repeat sync until `catalogReady` is `true`. Each call processes at most 20
subjects for one term. The scheduled sync also rotates through the oldest
completed subjects after initial publication. An ordinary manual sync recovers
incomplete subjects; it does not force a refresh of an already complete catalog.

To start a new GPA generation:

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/gpa"
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/gpa"
```

DELETE must report `reset_initiated`. Repeat POST until `success` and
`isComplete` are both `true`. After an interruption, resume with POST.
If the cached dataset expires during an import, start a new generation with
DELETE. Reset retains published GPA statistics while new source rows load.
The final import rebuilds GPA statistics and derived comparison data.

With `RMP_AUTH_TOKEN` configured, `POST /admin/enrich` refreshes Rate My
Professors data and rebuilds instructor links and scores. Failed subjects and
job state appear in `/admin/sync/status`; use `npx wrangler tail` with the target
configuration to inspect Worker errors. Progress and retry policy belong to
the Worker, so operational scripts call it rather than maintain a second queue.

## Inspect feedback

Select the target environment explicitly. For staging:

```bash
npx wrangler d1 execute DB --remote --env staging \
  --config apps/api/wrangler.toml \
  --command 'SELECT id, page, query, expected, message, created_at FROM feedback_events ORDER BY created_at DESC LIMIT 100'
```

Omit `--env staging` for production. Feedback stores the submitted text and
page/search context in D1. When a report identifies missing search behavior,
add a reproducer to the owning test or the public eval when the promise belongs
to the deployed API.

## Database changes and rollback

`apps/api/migrations/0001_schema.sql` is the canonical current schema. It
initializes a fresh database and does not upgrade the retired schema history.
For a schema change, create a new D1 database and update the target binding.
Keep the previous database intact; it contains the prior catalog and feedback.
Applying the same migration name to an old database does not upgrade it. The
release's schema probe rejects incompatible state.

For a Worker regression without a schema change, use Cloudflare's
[Worker rollback](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)
to restore a known version. For a database replacement, deploy the known source
revision with its previous binding ID. Check the previous database's schema
matches that Worker. Restore the corresponding web deployment through
[Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/).

Run the target smoke, public eval, and browser workflow after rollback. Avoid
the catalog-bootstrap release command during an urgent rollback if you only
intend to restore the previous Worker and binding.
