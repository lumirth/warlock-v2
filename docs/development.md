# Local development

Run commands from the repository root with Node 22.13+ or Node 24+ and npm 10 or later.
Install the locked dependencies with `npm ci`.

## Start the application

Copy the local configuration on first setup. If `.dev.vars` already exists,
update it instead of replacing your credentials.

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local -w @warlock-v2/api
npm run dev
```

The example file sets a development admin token and permits feedback from
`http://localhost:5173` and `http://127.0.0.1:5173`. Keep real credentials in
`.dev.vars`, which Git ignores. Use a separate credential for each deployed
environment.

Wrangler serves the API on port 8787 and persists local D1 and KV data under
`apps/api/.wrangler`. Vite serves the client on port 5173 and proxies `/api`
to the local Worker. Use the actual URLs printed by both servers if either
port is occupied.

## Load the catalog

A new database contains the schema but no courses. Leave `npm run dev` running
and use another terminal to discover current terms:

```bash
export API=http://localhost:8787
export ADMIN_TOKEN=local-development-token
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/discover-terms"
```

Discovery reads the university's published schedules and stores current term
classifications. Then advance the catalog:

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/sync"
```

Repeat that command until the response reports `catalogReady: true`. Each call
processes at most 20 subjects for one term. Initial loading needs several calls
and network access to Course Explorer. The Worker records progress in D1, so a
later call can resume an interrupted load.

Check the result:

```bash
curl -fsS "$API/"
curl -fsS "$API/api/search?q=CS%20225"
```

The root response should contain a term rather than `null`. The search response
should include CS 225. Open the local web client, search for `CS 225`, and follow
a result to see its sections and official course link.

For failures, inspect `GET /admin/sync/status` with the same authorization
header. Failed subjects include an error; running subjects retain a lease until
it expires. Correct upstream or configuration errors before retrying. Stopping
and restarting the dev server preserves the local database.

## Add comparison data

Search and course details work without ratings. To import historical GPA data,
call the same Worker endpoints used by deployment:

```bash
curl -fsS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/gpa"
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/gpa"
```

Repeat the POST until `success` and `isComplete` are both `true`. Continue with
POST after an interruption; DELETE starts a new import. The Worker downloads
the dataset, imports bounded chunks, and publishes the completed generation.

Rate My Professors enrichment requires `RMP_AUTH_TOKEN` in `.dev.vars`. Restart
Wrangler after adding it, then call `POST /admin/enrich`. This refreshes ratings
and rebuilds their links and scores. See [data sources](architecture.md#data-sources)
for where the comparison data comes from.

## Work on the client against the hosted API

To use the existing catalog while changing only the client:

```bash
VITE_API_PROXY_TARGET=https://warlock.lumirth.workers.dev \
  npm run dev -w @warlock-v2/web
```

Search and course reads use the hosted API. Feedback from a local browser origin
is rejected by that deployment's origin policy. Use the local Worker to develop
feedback submission.

`VITE_API_PROXY_TARGET` changes the development proxy. `VITE_API_BASE_URL` sets
the API URL embedded in a production build. For another local API port, set the
proxy target to that port and update `.dev.vars` if the web origin changes.

## Validate and reset

Run the [local gate](../README.md#verify-changes) before releasing. API integration
tests apply `apps/api/migrations/0001_schema.sql` to an isolated local D1 database;
they do not use your development catalog.

The schema has no historical upgrade path. After a schema change, stop Wrangler, preserve any local data you need, remove its local D1
state under `apps/api/.wrangler/state`, and rerun the migration command. This
discards the development catalog and feedback, which you must reload. Remote
database replacement follows [operations](operations.md#database-changes-and-rollback).
