# Smart Hybrid Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a scalable, hybrid natural language search system using Cloudflare Workers (Free), D1, Vectorize, and a client-side extraction strategy.

**Architecture:** Monorepo (`apps/api`, `apps/web`) sharing common types. The client (web) extracts intent using `compromise` (hints), and the server (api) authoritatively resolves hints to canonical IDs (D1) before executing a hybrid keyword+semantic search.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), Vectorize, Compromise.js, React (Client), Vitest.

---

## Phase 1: Monorepo Restructure

### Task 1: Create Monorepo Structure

**Files:**
- Modify: `package.json`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `packages/query-types/package.json`
- Move: `src/` -> `apps/api/src/`
- Move: `wrangler.toml` -> `apps/api/wrangler.toml`

**Step 1: Create directory structure**

```bash
mkdir -p apps/api apps/web packages/query-types
```

**Step 2: Initialize query-types package**

Create `packages/query-types/package.json`:
```json
{
  "name": "@uiuc-course-search/query-types",
  "version": "0.0.1",
  "main": "index.ts",
  "types": "index.ts"
}
```

Create `packages/query-types/index.ts`:
```typescript
export type QueryHintType = 'instructor' | 'gened' | 'subject' | 'credits' | 'term' | 'level';

export interface QueryHint {
  type: QueryHintType;
  value: string; // "Fagen", "Humanities"
  confidence: number; // 0-1
  isExplicit?: boolean; // true if user clicked a chip or typed "instructor:..."
}

export interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];
  residual: string; // "easy" (parts not covered by hints)
}

export interface SearchPlan {
  filters: {
    instructor_ids?: number[];
    gened_code?: string;
    subject?: string;
    level?: number;
    credits?: number;
    term?: string;
  };
  semanticQuery: string; // The residual to vector search
  keywordQuery: string;  // The residual to keyword search
}
```

**Step 3: Move API code**

```bash
mv src apps/api/src
mv wrangler.toml apps/api/wrangler.toml
mv package.json apps/api/package.json
mv tsconfig.json apps/api/tsconfig.json
```

**Step 4: Update API package.json**

Modify `apps/api/package.json` to change name to `@uiuc-course-search/api` and ensure dependencies are correct.

**Step 5: Create Root Workspace package.json**

Create `package.json` in root:
```json
{
  "name": "uiuc-course-search-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test": "npm test --workspaces"
  }
}
```

**Step 6: Commit**

```bash
git add .
git commit -m "chore: restructure into monorepo (apps/api, apps/web, packages/query-types)"
```

---

## Phase 2: Shared Extraction & Lite Parser

### Task 2: Create Query Extractor Lite (Server Fallback)

**Files:**
- Create: `packages/query-extractor-lite/package.json`
- Create: `packages/query-extractor-lite/index.ts`
- Test: `packages/query-extractor-lite/index.test.ts`

**Step 1: Initialize package**

Create `packages/query-extractor-lite/package.json`:
```json
{
  "name": "@uiuc-course-search/query-extractor-lite",
  "version": "0.0.1",
  "main": "index.ts",
  "dependencies": {
    "@uiuc-course-search/query-types": "*"
  }
}
```

**Step 2: Write failing test**

Create `packages/query-extractor-lite/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractQueryLite } from './index.js';

describe('extractQueryLite', () => {
  it('extracts gened patterns', () => {
    const result = extractQueryLite('easy gened humanities');
    expect(result.hints).toContainEqual(expect.objectContaining({ type: 'gened', value: 'humanities' }));
    expect(result.residual).toBe('easy');
  });

  it('extracts "by instructor" pattern', () => {
    const result = extractQueryLite('cs 225 by fagen');
    expect(result.hints).toContainEqual(expect.objectContaining({ type: 'instructor', value: 'fagen' }));
  });
});
```

**Step 3: Implement Lite Extractor**

Create `packages/query-extractor-lite/index.ts`:
```typescript
import type { ExtractedQuery, QueryHint } from '@uiuc-course-search/query-types';

export function extractQueryLite(query: string): ExtractedQuery {
  const hints: QueryHint[] = [];
  let residual = query;

  // Simple regex heuristics for server-side fallback

  // "by [Instructor]"
  const byMatch = residual.match(/\b(by|with|prof|professor)\s+([a-zA-Z]+)/i);
  if (byMatch) {
    hints.push({ type: 'instructor', value: byMatch[2], confidence: 0.8 });
    residual = residual.replace(byMatch[0], '');
  }

  // "gened [Category]" or "[Category] gened"
  const genedMatch = residual.match(/\b(gened|gen ed)\s+([a-zA-Z]+)|([a-zA-Z]+)\s+(gened|gen ed)/i);
  if (genedMatch) {
    const value = genedMatch[2] || genedMatch[3];
    hints.push({ type: 'gened', value: value, confidence: 0.7 });
    residual = residual.replace(genedMatch[0], '');
  }

  return {
    rawQuery: query,
    hints,
    residual: residual.replace(/\s+/g, ' ').trim()
  };
}
```

**Step 4: Verify tests**

Run: `npm test -w packages/query-extractor-lite`

**Step 5: Commit**

```bash
git add packages/query-extractor-lite
git commit -m "feat: add query-extractor-lite package with regex parser"
```

---

## Phase 3: Server-Side Resolution

### Task 3: Implement Query Resolver Service

**Files:**
- Create: `apps/api/src/services/query-resolver.ts`
- Test: `apps/api/src/services/__tests__/query-resolver.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/src/services/__tests__/query-resolver.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveQuery } from '../query-resolver.js';
import type { ExtractedQuery } from '@uiuc-course-search/query-types';

const mockDb = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(),
      all: vi.fn()
    }))
  }))
};

describe('resolveQuery', () => {
  it('resolves instructor hint to ID', async () => {
    // Mock DB response for instructor search
    const mockStmt = mockDb.prepare();
    mockStmt.bind().all.mockResolvedValue({ results: [{ id: 123, match_score: 0.9 }] });

    const extracted: ExtractedQuery = {
      rawQuery: 'cs 225 by fagen',
      hints: [{ type: 'instructor', value: 'fagen', confidence: 0.8 }],
      residual: 'cs 225'
    };

    const plan = await resolveQuery(mockDb as any, extracted);
    expect(plan.filters.instructor_ids).toEqual([123]);
  });
});
```

**Step 2: Implement Resolver**

Create `apps/api/src/services/query-resolver.ts`:
- Import `SearchPlan` from query-types.
- Implement fuzzy lookup for instructors (Trigram or LIKE).
- Implement strict mapping for GenEds.

**Step 3: Verify tests**

Run: `npm test -w apps/api`

**Step 4: Commit**

```bash
git add apps/api/src/services/query-resolver.ts
git commit -m "feat: add query resolver service to map hints to D1 IDs"
```

---

## Phase 4: Search Service Upgrade

### Task 4: Update Hybrid Search to use SearchPlan

**Files:**
- Modify: `apps/api/src/services/search.ts`

**Step 1: Modify hybridSearch signature**

Update to accept `SearchPlan` instead of raw `filters`.

**Step 2: Implement SQL Generation from Plan**

Update `keywordSearch` to:
- Use `filters.instructor_ids` (JOIN `meeting_instructors`).
- Use `filters.gened_code` (JOIN `course_gened`).

**Step 3: Implement Vector Generation from Plan**

Update `semanticSearch` to:
- Pass metadata filters: `{ gened_code: plan.filters.gened_code }`.

**Step 4: Commit**

```bash
git add apps/api/src/services/search.ts
git commit -m "refactor: upgrade hybrid search to execute structured SearchPlan"
```

---

## Phase 5: Client (Reference Implementation)

### Task 5: Create Web App & NLP Extractor

**Files:**
- Create: `apps/web/src/lib/extractor.ts`
- Create: `apps/web/src/App.tsx`

**Step 1: Initialize Vite App**

```bash
cd apps/web && npm create vite@latest . -- --template react-ts
npm install compromise @uiuc-course-search/query-types
```

**Step 2: Implement Client Extractor**

Create `apps/web/src/lib/extractor.ts` using `compromise`:
```typescript
import nlp from 'compromise';
import type { ExtractedQuery } from '@uiuc-course-search/query-types';

export function extractQuery(text: string): ExtractedQuery {
  const doc = nlp(text);
  const hints = [];

  // Use compromise logic here
  // ...

  return { rawQuery: text, hints, residual: doc.text() };
}
```

**Step 3: Create UI**

Simple input box that calls `extractQuery` on change, displays chips, and calls API on submit.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add reference client with compromise-based extraction"
```

---

## Summary

This plan breaks the work into 5 distinct phases:
1.  **Monorepo**: Sets up the structure.
2.  **Shared Logic**: Builds the types and server-side lite parser.
3.  **Resolver**: Implements the "Server Authority".
4.  **Search Engine**: Updates the core search logic.
5.  **Client**: Demonstrates the "Client Hints" UX.
