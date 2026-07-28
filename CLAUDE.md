# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UIUC Course Search is a smart course search engine for the University of Illinois at Urbana-Champaign. It combines hybrid search (semantic + keyword with RRF fusion) to help students find courses using natural language queries like "easy cs gened" or "data structures with fagen".

## Commands

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

Default build is offline/deterministic. `npm run generate:subjects` is manual and intentionally separate from `npm run build`.

### Development
```bash
npm run dev -w @uiuc-course-search/api
npm run dev -w @uiuc-course-search/web
```

### Database (D1)
```bash
npm run db:verify
npm run bootstrap:fresh-check
npx wrangler d1 execute course-search-db --file=apps/api/migrations/0001_initial_schema.sql
```

The canonical baseline migration in `apps/api/migrations/0001_initial_schema.sql` must remain byte-for-byte identical to `apps/api/src/db/schema.sql`. Generated SQL dumps remain ignored, but this migration is a tracked source artifact.

## Architecture

### Monorepo Structure
- `apps/api` - Cloudflare Worker API (Hono framework)
- `apps/web` - React frontend (Vite)
- `packages/query-types` - Shared TypeScript types for query processing
- `docs/archive` - Historical plans and analysis; not current implementation instructions

### Sync & Discovery Architecture
- **Worker adapter** (`index.ts`): delegates scheduled events to `services/scheduled-workflows.ts`; keep cron workflow details out of the entrypoint.
- **Scheduled workflow policy** (`services/scheduled-workflows.ts`): maps cron strings to named workflows and dispatches them via `waitUntil`.
- **Auto-discovery** (`services/term-discovery.ts`): twice-daily cron (`0 10,22 * * *`) discovers terms and classifies them as `registrable`, `active`, or `historical`.
- **Fan-out course sync** (`services/sync-coordinator.ts`, `services/parallel-sync.ts`, `routes/sync-course-routes.ts`): twice daily, active and registrable terms are split into subject batches and dispatched through the `SELF` service binding. Only an all-subject successful coordinator run publishes term freshness and reconciles subjects removed from the authoritative term manifest.
- **Snapshot persistence** (`transforms/course.ts`, `services/snapshot-persistence-operations.ts`, `services/snapshot-persistence-sql.ts`, `services/course-snapshot-writer.ts`): CISAPI data flows through a canonical `CourseSnapshot`; operation planning is separate from prepared D1 execution.

### Search Pipeline
Search is intentionally split between interpretation, execution, and presentation. Each stage owns one product concept; routes and public DTOs do not reinterpret internal search state.

1. **HTTP contract** (`packages/query-types/search-contract.ts`, `packages/query-types/search-request-codec.ts`, `http/search-request.ts`): owns and decodes the canonical immutable public search request.
2. **Query planning** (`services/query-parser.ts`, `services/extractor.ts`, `services/query-resolver.ts`, `services/search-plan-compiler.ts`): parses power syntax, extracts hints, validates hints, resolves subject/GenEd ambiguity, and produces one immutable plan.
3. **Retrieval planning** (`services/search-retrieval-plan.ts`): derives the executable lanes and candidate budgets from the immutable plan.
4. **Retrieval execution** (`services/search-executor.ts`, `services/search-hybrid.ts`, `services/search-retrieval-lane-executors.ts`): runs exact, FTS, structured, and optional Vectorize recall before term ordering and applied controls.
5. **Ranking policy** (`services/ranking/*`): named score components, requirement/avoidance/accessibility policy, attribute sort behavior, nulls-last sort semantics, and term ordering.
6. **Response presentation** (`services/search-pipeline-result.ts`, `services/search-response-presenter.ts`, `services/search-result-presentation.ts`, `services/search-ui-plan.ts`): converts the private pipeline result into public DTOs, chips, explanations, and warnings.

### Course Detail Boundary
- `routes/course.ts` only adapts HTTP params/headers to `CourseDetailRequest`.
- `http/course-detail-request.ts` owns course-detail request validation.
- `services/course-detail-service.ts` owns cache freshness, stale fallback, live fetch policy, enrichment loading, and response state.
- `services/course-detail-live-source.ts` owns CISAPI XML fetch/parse/transform for live course details.
- `services/course-detail-repository.ts` owns D1 reads for cached details, sections, meetings, GenEds, GPA, and instructor enrichment.

### Cloudflare Bindings
- `DB` - D1 database
- `VECTORIZE` - Vector index
- `AI` - Workers AI (`bge-small-en-v1.5`)
- `SELF` - Service binding for fan-out sync dispatch
- `SEARCH_RATE_LIMITER` - Public search request limit
- `COURSE_RATE_LIMITER` - Public course-detail request limit
- `FEEDBACK_RATE_LIMITER` - Lower-volume feedback write limit
- `FEEDBACK_ALLOWED_ORIGINS` - Comma-separated exact frontend origins permitted to write feedback
- `ADMIN_TOKEN` - Bearer token for `/admin/*`
- `INTERNAL_TOKEN` - Bearer token for `/internal/*`
- `RMP_AUTH_TOKEN` - RMP GraphQL authorization value when RMP sync is enabled

### Public HTTP Surface

- Reads: `GET /`, `GET /health`, `GET /api/search`, `GET /api/course/:subject/:number`, `GET /api/terms`
- Anonymous write: `POST /api/feedback`, with a bounded JSON contract, dedicated rate limit, and configured-origin check

## Active Docs

- `README.md`
- `docs/deployment-checklist.md`
- `docs/cloudflare-hardening-runbook.md`
- `docs/release-checklist.md`
- `docs/rollback-checklist.md`
- `docs/security-route-matrix.md`
- `docs/architecture/search-ownership.md`
- `docs/architecture/course-data-vocabulary.md`
- `docs/search-interpretation-chip-model.md`

## GenEd Codes
Common UIUC gened categories: `HUM`, `NAT`, `SBS`, `CS`, `QR1`, `QR2`, `ACP`, `NW`, `US`, `WCC`.

Full requirement evidence flows through `course_gened`, `CourseRequirementDto`, and `transforms/course-requirements.ts`.
