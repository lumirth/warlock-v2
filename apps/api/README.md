# UIUC Course Search API

This is the backend for the pre-alpha UIUC Course Search engine, built as a Cloudflare Worker using Hono. Treat this package as greenfield: remove stale routes/config instead of preserving compatibility aliases.

## Data Sync Architecture

The API implements a sophisticated synchronization system to ingest course data from the UIUC CISAPI.

### Fan-Out Sync Architecture
To stay within Cloudflare Worker resource limits (subrequests, memory, and CPU time), the sync process uses a fan-out pattern:

1.  **Worker adapter:** `src/index.ts` delegates scheduled events to `services/scheduled-workflows.ts`. The entrypoint should not grow cron workflow branches.
2.  **Workflow policy:** `services/scheduled-workflows.ts` maps cron schedules to named workflows and dispatches them with `waitUntil`.
3.  **Coordinator:** `services/sync-coordinator.ts` discovers active terms and splits subject work into batches capped by `services/sync-batch-contract.ts`.
4.  **Parallel execution:** `routes/sync-course-routes.ts` handles internal service-binding batch endpoints.
5.  **Subject cascade:** `services/parallel-sync.ts` fetches and parses CISAPI cascade XML.
6.  **Snapshot persistence:** `transforms/course.ts`, `services/snapshot-persistence-operations.ts`, `services/snapshot-persistence-sql.ts`, and `services/course-snapshot-writer.ts` transform parsed data into `CourseSnapshot`, plan writes once, and render D1 or raw-SQL output from the same operations.

### Auto-Discovery Mechanism
The system automatically discovers new academic terms to sync:

*   **Twice-Daily Discovery:** A cron job runs daily at 10:00 and 22:00 UTC.
*   **Term Classification:** New terms are probed for `enrollmentStatus`. Open-like sections make a term `registrable`; other real statuses make it `active`; terms without real enrollment status are `historical`.
*   **Historical Archive:** Historical terms remain available for reference but are synced less frequently.

## Key Boundaries

### Search

*   `packages/query-types/search-contract.ts`, `packages/query-types/search-request-codec.ts`, and `http/search-request.ts`: canonical immutable public request and HTTP decoding.
*   `services/search-request-filters.ts`: the named public-filter to internal-plan-filter boundary.
*   `services/search-plan-compiler.ts`, `services/search-plan-intents.ts`, `services/query-resolver.ts`, `services/subject-resolution.ts`: query understanding and plan construction.
*   `services/search-pipeline.ts`: planning/cache orchestration only.
*   `services/search-retrieval-plan.ts`, `services/search-retrieval-lane-executors.ts`, `services/search-retrieval-*-lanes.ts`, `services/search-hybrid.ts`: executable retrieval planning and focused lane execution.
*   `services/course-sync-application.ts`, `services/enrichment-application.ts`, `services/sync-operations.ts`: sync and enrichment application workflows shared by cron, internal, and admin route adapters.
*   `services/ranking/*`: named ranking components, final ordering controls, sort policy, workload/requirement/negative-preference policy.
*   `services/search-pipeline-result.ts`: private result passed from search execution to presentation.
*   `services/search-response-presenter.ts`, `services/search-result-presentation.ts`, `services/search-ui-plan.ts`, `services/search-*-presenter.ts`: public response DTOs, visible match evidence, chips, and actions.

### Course Detail

*   `routes/course.ts`: transport adapter only.
*   `http/course-detail-request.ts`: validates HTTP params/query/header state into `CourseDetailRequest`.
*   `services/course-detail-service.ts`: owns cache freshness, stale fallback, live fetch policy, enrichment loading, and response state.
*   `services/course-detail-live-source.ts`: owns live CISAPI detail fetch, XML parsing, and snapshot transform.
*   `services/course-detail-repository.ts`: owns D1 read models for cached detail, sections, meetings, requirements, GPA, and instructor enrichment.

### Data

*   `services/term-discovery.ts`: finds and classifies terms.
*   `services/parallel-sync.ts`: fetches/parses subject cascades for sync batches.
*   `transforms/course.ts`: canonical CISAPI-to-`CourseSnapshot` transform.
*   `transforms/course-requirements.ts`: canonical full requirement evidence from snapshots.
*   `services/embeddings.ts`: vector embedding generation/storage from canonical snapshot evidence.
*   `migrations/*.sql`: immutable ordered upgrades for existing D1 databases.
*   `src/db/schema.sql`: current-state bootstrap for a new database.

Full requirement behavior uses `course_gened`, `CourseRequirementDto`, and `transforms/course-requirements.ts`.

## Testing

`npm test -w @uiuc-course-search/api` runs two intentionally different suites:

*   `test:unit` runs fast Node-based unit and boundary tests. These may mock focused dependencies.
*   `test:integration` runs the Worker through Cloudflare's Workers Vitest pool. It applies the canonical D1 migrations to isolated local D1 storage and sends requests through the real Worker entrypoint. Integration tests must seed rows through the D1 binding; they must not simulate SQL by matching query strings.

The integration configuration declares only local bindings. It deliberately does not connect to remote AI or Vectorize resources.

## Configuration

Settings are managed in `wrangler.toml`:
*   `SYNC_CONCURRENCY`: Number of subjects to process in parallel within a single batch worker.

Deploy staging explicitly from the repository root:

```bash
npm run deploy:api:staging
```
