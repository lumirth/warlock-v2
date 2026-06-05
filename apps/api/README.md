# UIUC Course Search API

This is the backend for the pre-alpha UIUC Course Search engine, built as a Cloudflare Worker using Hono. Treat this package as greenfield: remove stale routes/config instead of preserving compatibility aliases.

## Data Sync Architecture

The API implements a sophisticated synchronization system to ingest course data from the UIUC CISAPI.

### Fan-Out Sync Architecture
To stay within Cloudflare Worker resource limits (subrequests, memory, and CPU time), the sync process uses a fan-out pattern:

1.  **Worker adapter:** `src/index.ts` delegates scheduled events to `services/scheduled-workflows.ts`. The entrypoint should not grow cron workflow branches.
2.  **Workflow policy:** `services/scheduled-workflows.ts` maps cron schedules to named workflows and dispatches them with `waitUntil`.
3.  **Coordinator:** `services/sync-coordinator.ts` discovers active terms and splits subject work into batches of **40 subjects** each.
4.  **Parallel execution:** `routes/sync-course-routes.ts` handles internal service-binding batch endpoints.
5.  **Subject cascade:** `services/parallel-sync.ts` fetches and parses CISAPI cascade XML.
6.  **Snapshot persistence:** `transforms/course.ts`, `services/snapshot-persistence-operations.ts`, and `services/course-snapshot-writer.ts` transform parsed data into `CourseSnapshot` and write D1 rows, SQL artifacts, and embeddings from that canonical shape.

### Auto-Discovery Mechanism
The system automatically discovers new academic terms to sync:

*   **Twice-Daily Discovery:** A cron job runs daily at 4:00 AM & 4:00 PM CST (10:00 & 22:00 UTC).
*   **Term Classification:** New terms are probed for "enrollmentStatus". If sections have real statuses (not "UNKNOWN"), the term is marked as `active` and added to the 5-minute sync rotation.
*   **Historical Archive:** Terms with no active enrollment are marked as `historical` and kept in the database for reference but synced less frequently.

## Key Boundaries

### Search

*   `http/search-request.ts` and `services/search-request.ts`: public request parsing and canonical immutable search request.
*   `services/search-plan-compiler.ts`, `services/search-plan-hints.ts`, `services/search-plan-intent-passes.ts`, `services/query-resolver.ts`, `services/subject-resolution.ts`: query understanding and plan construction.
*   `services/search-pipeline.ts`: planning/cache orchestration only.
*   `services/search-retrieval-plan.ts`, `services/search-retrieval-lane-executors.ts`, `services/search-retrieval-*-lanes.ts`, `services/search-hybrid.ts`: executable retrieval planning and focused lane execution.
*   `services/course-sync-application.ts`, `services/enrichment-application.ts`, `services/sync-operations.ts`: sync and enrichment application workflows shared by cron, internal, and admin route adapters.
*   `services/ranking/*`: named ranking components, final ordering controls, sort policy, workload/requirement/negative-preference policy.
*   `services/search-response.ts`, `services/search-response-presenter.ts`, `services/search-result-presentation.ts`, `services/search-ui-plan.ts`, `services/search-*-presenter.ts`: response DTOs, explanations, chips, actions, and recovery metadata.

### Course Detail

*   `routes/course.ts`: transport adapter only.
*   `http/course-detail-request.ts`: validates HTTP params/query/header state into `CourseDetailRequest`.
*   `services/course-detail-service.ts`: owns cache freshness, stale fallback, live fetch policy, enrichment loading, and response state.
*   `services/course-detail-live-source.ts`: owns live CISAPI detail fetch, XML parsing, and snapshot transform.
*   `services/course-detail-repository.ts`: owns D1 read models for cached detail, sections, meetings, GenEds, GPA, and instructor enrichment.

### Data

*   `services/term-discovery.ts`: finds and classifies terms.
*   `services/parallel-sync.ts`: fetches/parses subject cascades for sync batches.
*   `transforms/course.ts`: canonical CISAPI-to-`CourseSnapshot` transform.
*   `transforms/course-requirements.ts`: canonical full requirement evidence from snapshots.
*   `services/embeddings.ts`: vector embedding generation/storage from canonical snapshot evidence.

Full GenEd/requirement behavior should use `course_gened`, `CourseGenedDto`, and `transforms/course-requirements.ts`. The flat `courses.gened` field is retained as a denormalized compatibility summary and should not be treated as the source of truth.

## Configuration

Settings are managed in `wrangler.toml`:
*   `SYNC_CONCURRENCY`: Number of subjects to process in parallel within a single batch worker.

Deploy staging explicitly from the repository root:

```bash
npm run deploy:api:staging
```
