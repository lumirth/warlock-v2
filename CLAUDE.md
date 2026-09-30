# Repository guidance

Course Warlock v2 Beta is a Cloudflare Worker/D1 API with a React/Vite client. Keep
changes at the narrowest owning boundary and prefer observable behavior over
tests of call wiring, SQL strings, or duplicated intermediate objects.

## Local gate

```bash
npm ci
npm run build
npm test
npm run lint
npm run bundle:budget
npm run security:secrets
npm audit --audit-level=high
```

`npm run build` already typechecks every workspace. Do not add a second build,
schema bootstrap, generated corpus, or local planner-smoke gate.

## Ownership

- `apps/api/src/http`: public request decoding and limits.
- `apps/api/src/services/search-plan-compiler.ts`: query interpretation.
- `apps/api/src/services/search-engine.ts`: retrieval and ranking.
- `apps/api/src/services`: catalog, sync, enrichment, and presentation behavior.
- `apps/api/src/routes`: HTTP adaptation only.
- `apps/api/src/db`: D1 repositories.
- `apps/api/src/eval`: compact deployed public-contract scenarios.
- `apps/web/src`: UI and URL state.
- `packages/query-types`: shared request vocabulary.
- `apps/api/migrations`: sole schema authority.

The Worker owns synchronization, retry, publication, and enrichment state.
Scripts must not copy those state machines. Operational commands should invoke
the Worker or Cloudflare directly and verify the resulting boundary.

## Invariants

- Public search filters must constrain every returned result.
- Search request state is immutable across interpretation, retrieval, ranking,
  and presentation.
- Only a complete authoritative subject run may publish freshness or prune
  vanished course data.
- D1 snapshot publication and fencing updates remain atomic.
- `/admin/*` requires its credential; public feedback has a configured-origin,
  body-size, and dedicated rate-limit boundary.
- `apps/api/migrations/0001_schema.sql` is the current canonical schema. Do not
  recreate `src/db/schema.sql` or a verifier that compares two schema copies.
- The current schema has no historical upgrade path; bind a fresh D1 database
  after schema changes.

## Verification placement

Use pure unit tests for algorithms with dense edge cases. Use migrated-D1 tests
for SQL, atomicity, and repository behavior. Use actual-app tests for auth and
route policy. Use a few user workflows for UI behavior. Use
`apps/api/src/eval/scenarios.ts` only for promises visible through the deployed
public API.

Do not assert exact private score magnitudes, SQL serialization, mock call
counts, filenames repeated in prose, or hand-maintained route inventories.

Deployment, recovery, refresh, and rollback instructions live in
`docs/operations.md`.
