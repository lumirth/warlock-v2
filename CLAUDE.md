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
- **Auto-discovery** (`services/term-discovery.ts`): twice-daily cron (`0 10,22 * * *`) discovers terms and classifies them as `active` or `historical`.
- **Fan-out course sync** (`services/sync-coordinator.ts`, `services/parallel-sync.ts`, `routes/sync-course-routes.ts`): every 5 minutes (`*/5 * * * *`), active terms are split into subject batches and dispatched through the `SELF` service binding.
- **Snapshot persistence** (`transforms/course.ts`, `services/snapshot-persistence-operations.ts`, `services/course-snapshot-writer.ts`): CISAPI data flows through a canonical `CourseSnapshot` shape before D1 writes, SQL artifacts, embeddings, or DTO projection.

### Search Pipeline
Search is intentionally split between interpretation, execution, and presentation. Avoid adding new search behavior to `services/search.ts`; it is now a compatibility-facing facade, not the policy owner.

1. **HTTP contract** (`http/search-request.ts`, `services/search-request.ts`): normalizes public request fields into a canonical immutable search request.
2. **Query planning** (`services/query-parser.ts`, `services/extractor.ts`, `services/query-resolver.ts`, `services/search-plan-compiler.ts`): parses power syntax, extracts hints, validates hints, resolves subject/GenEd ambiguity, applies intent passes, and produces immutable plans plus fallback plans.
3. **Retrieval planning** (`services/search-retrieval-plan.ts`): derives executable lanes and candidate budgets from the immutable plan. Explanatory lanes in response metadata are not execution config.
4. **Retrieval execution** (`services/search-executor.ts`, `services/search-hybrid.ts`, `services/search-retrieval-lanes.ts`, `services/search-term-ranking.ts`): runs FTS, structured lanes, aliases, workload evidence, and optional Vectorize recall.
5. **Ranking policy** (`services/ranking/*`): named score components, requirement/workload/negative-preference policy, attribute sort behavior, nulls-last sort semantics, and term ordering.
6. **Response presentation** (`services/search-response.ts`, `services/search-result-presentation.ts`, `services/search-ui-plan.ts`): builds public DTOs, chips, explanations, warnings, and recovery groups.

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
- `ADMIN_TOKEN` - Bearer token for `/admin/*`
- `INTERNAL_TOKEN` - Bearer token for `/internal/*`
- `RMP_AUTH_TOKEN` - RMP GraphQL authorization value when RMP sync is enabled

## Active Docs

- `README.md`
- `docs/deployment-checklist.md`
- `docs/cloudflare-hardening-runbook.md`
- `docs/release-checklist.md`
- `docs/rollback-checklist.md`
- `docs/security-route-matrix.md`
- `docs/plans/2026-06-01-search-contract-v1.md`
- `docs/plans/2026-06-01-pre-alpha-remediation-master-plan.md`
- `docs/plans/2026-06-01-stabilization-hardening-master-plan.md`
- `docs/reports/2026-06-01-stabilization-report.md`

## GenEd Codes
Common UIUC gened categories: `HUM`, `NAT`, `SBS`, `CS`, `QR1`, `QR2`, `ACP`, `NW`, `US`, `WCC`.

Full requirement evidence should flow through `course_gened` / `CourseGenedDto` / `transforms/course-requirements.ts`. The flat `courses.gened` column is a denormalized compatibility summary, not the source of truth for requirement display, ranking, or embeddings.
