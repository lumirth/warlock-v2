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

## GenEd Codes
Common UIUC gened categories: `HUM`, `NAT`, `SBS`, `CS`, `QR1`, `QR2`, `ACP`, `NW`, `US`, `WCC`.
