# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UIUC Course Search is a smart course search engine for the University of Illinois at Urbana-Champaign. It combines hybrid search (semantic + keyword with RRF fusion) to help students find courses using natural language queries like "easy cs gened" or "data structures with fagen".

## Commands

### Development
```bash
# API (Cloudflare Worker)
cd apps/api && npm run dev          # Start local dev server with wrangler
cd apps/api && npm run typecheck    # TypeScript check only
cd apps/api && npm run check        # Typecheck + tests

# Web (React + Vite)
cd apps/web && npm run dev          # Start Vite dev server
cd apps/web && npm run build        # Build for production
```

### Testing
```bash
# Run all API tests
cd apps/api && npm test

# Run specific test file
cd apps/api && npx vitest run src/services/__tests__/query-resolver.test.ts

# Watch mode
cd apps/api && npm run test:watch

# Run specific test suites
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts
cd apps/api && npx vitest run src/services/__tests__/golden.test.ts
```

### Deployment
```bash
# API (Cloudflare Worker)
cd apps/api && npm run deploy       # Runs check then wrangler deploy

# Web (Cloudflare Pages)
cd apps/web && npm run build
cd apps/web && npx wrangler pages deploy dist --project-name uiuc-course-search-web
```

### Database (D1)
```bash
# Run migrations
cd apps/api && npx wrangler d1 execute course-search-db --file=../../migrations/your-migration.sql

# Interactive SQL shell
cd apps/api && npx wrangler d1 execute course-search-db --command="SELECT * FROM courses LIMIT 5"
```

## Architecture

### Monorepo Structure
- `apps/api` - Cloudflare Worker API (Hono framework)
- `apps/web` - React frontend (Vite)
- `packages/query-types` - Shared TypeScript types for query processing

### Search Pipeline

1. **Query Parsing** (`services/query-parser.ts`): Parses power-user syntax (`field:value`, `gened:any(...)`, `-negations`).

2. **Query Extraction** (`services/extractor.ts`): Three-phase extraction (regex → alias → NLP) extracts structured hints from natural language (course codes, instructors, geneds, days, times, credits, etc.).

3. **Query Resolution** (`services/query-resolver.ts`): Validates hints against database - resolves subject codes, instructor names to IDs, gened synonyms to canonical codes. Handles ambiguities (e.g., "CS" could be Computer Science subject or Cultural Studies gened).

4. **Hybrid Search** (`services/search.ts`): Runs keyword search (FTS5) and semantic search (Vectorize) in parallel, combines with Reciprocal Rank Fusion (RRF). Term prioritization ranks registrable > active > historical terms.

5. **Semantic Search** (`services/embeddings.ts`): Uses Cloudflare AI (`bge-small-en-v1.5`) for embeddings, stored in Vectorize index.

### Data Source

Course data synced from UIUC CISAPI (courses.illinois.edu/cisapp/explorer). The `cisapi/` directory contains the XML parsing client.

### Key Types

```typescript
// Query extraction output
interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];  // Structured filters extracted
  residual: string;    // Remaining text for semantic search
}

// After validation against DB
interface SearchPlan {
  filters: SearchFilters;  // instructor_ids, subject, number, gened_code, etc.
  semanticQuery: string;
  keywordQuery: string;
  ambiguities?: Ambiguity[];
}
```

### Cloudflare Bindings

The API uses these Cloudflare bindings (configured in `wrangler.toml`):
- `DB` - D1 database with courses, sections, instructors, geneds
- `VECTORIZE` - Vector index for semantic search
- `AI` - Workers AI for embedding generation

## Testing Notes

- API tests use `@cloudflare/vitest-pool-workers` which runs tests in the Workers runtime
- Tests mock D1 database calls with vitest mocks
- Integration tests in `__tests__/*.integration.test.ts` test against real D1

## GenEd Codes

Common UIUC gened categories: `HUM`, `NAT`, `SBS`, `CS` (Cultural Studies), `QR1`, `QR2`, `ACP`, `NW`, `US`, `WCC`. The resolver maps synonyms like "humanities" -> `HUM`, "quantitative" -> `QR`.
