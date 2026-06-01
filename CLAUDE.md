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

### Sync & Discovery Architecture (Fan-Out)
- **Auto-Discovery**: Twice-daily cron (`0 10,22 * * *`) discovers new terms and classifies them as `active` or `historical`.
- **Fan-Out Sync**: Every 3 minutes, the coordinator identifies active terms, splits subjects into batches of 40, and dispatches them via Service Bindings for parallel processing.
- **Batch Workers**: Handle XML cascade parsing, D1 upserts, and Vectorize embedding generation.

### Search Pipeline
1. **Query Parsing** (`services/query-parser.ts`): Parses power-user syntax.
2. **Query Extraction** (`services/extractor.ts`): Three-phase extraction (regex → alias → NLP).
3. **Query Resolution** (`services/query-resolver.ts`): Validates hints against database.
4. **Hybrid Search** (`services/search.ts`): Keyword (FTS5) + Semantic (Vectorize) via RRF fusion.

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
