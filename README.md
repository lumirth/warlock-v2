# UIUC Course Search

UIUC Course Search is a React application backed by a Cloudflare Worker, D1,
and optional Vectorize recall. It supports course-code navigation, structured
filters, natural-language search, course details, and scheduled catalog and
enrichment refreshes.

## Develop

Use Node 22 and the committed lockfile:

```bash
npm ci
npm run dev
```

The complete local gate is deliberately small:

```bash
npm run build
npm test
npm run lint
npm run bundle:budget
npm run security:secrets
npm audit --audit-level=high
```

`npm run build` compiles every workspace and creates the production web bundle.
Local web development proxies `/api` to `http://localhost:8787`; override it
with `VITE_API_PROXY_TARGET` when Wrangler uses another port.

## System boundaries

- `apps/api`: Hono Worker, search, synchronization, enrichment, and D1 access.
- `apps/web`: React/Vite client.
- `packages/query-types`: shared public request vocabulary.
- `apps/api/migrations/0001_schema.sql`: the sole database schema authority.

Public reads are `/`, `/health`, `/api/search`, `/api/course/:subject/:number`,
and `/api/terms`. `POST /api/feedback` is origin-, size-, and rate-limited.
`/admin/*` and `/internal/*` use separate bearer tokens.

Search interpretation, retrieval, ranking, and presentation are separate API
modules, but the public request and response are the stable contract. D1
integration tests and the deployed public eval cover that boundary without
copying the pipeline into a test framework.

## Database and deployment

`apps/api/migrations/0001_schema.sql` is a clean-slate pre-alpha schema, not an
upgrade path for databases created by the deleted migration history. Point the
binding at a fresh D1 database when it changes, leaving the previous binding as
the rollback. Deployment probes the schema and requires a populated active term.

See [docs/operations.md](docs/operations.md) for database recovery, release,
live verification, manual refresh, feedback inspection, and rollback commands.

Operational commands and recovery procedures live in [docs/operations.md](docs/operations.md).
