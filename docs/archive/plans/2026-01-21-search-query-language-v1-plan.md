# Search Query Language v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Google-style query syntax (quotes, negation, top-level OR, field filters) that maps to SearchPlan and supports multi-GenEd any/all.

**Architecture:** Parse raw user queries into clause-level plans using `search-string`, normalize field filters, resolve hints to IDs, and execute each clause in the existing hybrid search pipeline. Merge clause results, rerank, and return explainability metadata for UI chips, badges, and disambiguation.

**Tech Stack:** Cloudflare Workers (Hono), TypeScript, D1 (SQLite), Vectorize, `search-string`, Vitest.

---

### Task 1: Add query parser utility

**Files:**
- Create: `apps/api/src/services/query-parser.ts`
- Test: `apps/api/src/services/__tests__/query-parser.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseQueryClauses } from '../query-parser.js';

describe('parseQueryClauses', () => {
  it('splits top-level OR into clauses', () => {
    const result = parseQueryClauses('cs 225 OR ece 120');
    expect(result).toHaveLength(2);
    expect(result[0].raw).toBe('cs 225');
    expect(result[1].raw).toBe('ece 120');
  });

  it('extracts filters, negations, and phrases', () => {
    const result = parseQueryClauses('gened:HUM "easy class" -math');
    expect(result[0].filters).toEqual([{ field: 'gened', value: 'HUM' }]);
    expect(result[0].negations).toEqual(['math']);
    expect(result[0].phrases).toEqual(['easy class']);
  });

  it('parses gened:any and gened:all', () => {
    const result = parseQueryClauses('gened:any(HUM,US) gened:all(NW,US)');
    expect(result[0].genedMode).toEqual({ any: ['HUM', 'US'], all: ['NW', 'US'] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/services/__tests__/query-parser.test.ts`
Expected: FAIL (parser not implemented)

**Step 3: Write minimal implementation**

```typescript
// apps/api/src/services/query-parser.ts
import SearchString from 'search-string';

export interface ParsedClause {
  raw: string;
  filters: { field: string; value: string; negated?: boolean }[];
  negations: string[];
  phrases: string[];
  terms: string[];
  genedMode?: { any?: string[]; all?: string[] };
}

const OR_REGEX = /\s+OR\s+/i;

export function parseQueryClauses(query: string): ParsedClause[] {
  const clauses = query.split(OR_REGEX).map(q => q.trim()).filter(Boolean);
  return clauses.map(raw => parseClause(raw));
}

function parseClause(raw: string): ParsedClause {
  const parsed = SearchString.parse(raw);
  const conditions = parsed.getConditionArray();

  const filters: ParsedClause['filters'] = [];
  const negations: string[] = [];
  const phrases: string[] = [];
  const terms: string[] = [];
  const genedMode: ParsedClause['genedMode'] = {};

  for (const cond of conditions) {
    if ('keyword' in cond) {
      const field = cond.keyword.toLowerCase();
      const value = String(cond.value).trim();
      if (field === 'gened' && /^any\(|^all\(/i.test(value)) {
        const mode = value.startsWith('all') ? 'all' : 'any';
        const list = value.replace(/^\w+\(|\)$/g, '').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
        genedMode[mode] = list;
        continue;
      }
      filters.push({ field, value });
      continue;
    }

    const text = String(cond.text || '').trim();
    if (!text) continue;

    if (cond.negated) {
      negations.push(text);
    } else if (text.startsWith('"') && text.endsWith('"')) {
      phrases.push(text.slice(1, -1));
    } else {
      terms.push(text);
    }
  }

  return { raw, filters, negations, phrases, terms, genedMode };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/services/__tests__/query-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/query-parser.ts apps/api/src/services/__tests__/query-parser.test.ts
git commit -m "feat(search): add query parser for v1 syntax"
```

---

### Task 2: Map parsed clauses to SearchPlan

**Files:**
- Modify: `apps/api/src/services/query-resolver.ts`
- Modify: `packages/query-types/index.ts`
- Test: `apps/api/src/services/__tests__/query-resolver.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { resolveQuery } from '../query-resolver.js';

const mockDb = {
  prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(), all: vi.fn() })) }))
};

describe('resolveQuery', () => {
  it('maps gened:any and gened:all into plan filters', async () => {
    const extracted = {
      rawQuery: 'gened:any(HUM,US) gened:all(NW,US)',
      hints: [],
      residual: ''
    };

    const plan = await resolveQuery(mockDb as any, extracted, {
      parsedClauses: [{
        raw: extracted.rawQuery,
        filters: [{ field: 'gened', value: 'any(HUM,US)' }, { field: 'gened', value: 'all(NW,US)' }],
        negations: [],
        phrases: [],
        terms: [],
        genedMode: { any: ['HUM', 'US'], all: ['NW', 'US'] }
      }]
    });

    expect(plan.filters.gened_any).toEqual(['HUM', 'US']);
    expect(plan.filters.gened_all).toEqual(['NW', 'US']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/services/__tests__/query-resolver.test.ts`
Expected: FAIL (gened_any/gened_all missing)

**Step 3: Write minimal implementation**

```typescript
// packages/query-types/index.ts
export interface SearchFilters {
  gened_any?: string[];
  gened_all?: string[];
  // ...existing fields
}
```

```typescript
// apps/api/src/services/query-resolver.ts
export async function resolveQuery(db: D1Database, extracted: ExtractedQuery, options?: { parsedClauses?: ParsedClause[] }): Promise<SearchPlan> {
  // map gened_any/gened_all from parsed clauses before hint loop
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/services/__tests__/query-resolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/query-types/index.ts apps/api/src/services/query-resolver.ts apps/api/src/services/__tests__/query-resolver.test.ts
git commit -m "feat(resolver): support gened any/all filters"
```

---

### Task 3: Apply gened_any/gened_all in keyword search

**Files:**
- Modify: `apps/api/src/services/search.ts`
- Test: `apps/api/src/services/__tests__/search.integration.test.ts`

**Step 1: Write the failing test**

```typescript
// Add a test that ensures gened_any expands to OR in course_gened joins
// and gened_all requires all categories via grouping.
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/services/__tests__/search.integration.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// apps/api/src/services/search.ts
// In keywordSearch, when building joins/where:
// - gened_any: WHERE cg.category_id IN (...)
// - gened_all: GROUP BY c.id HAVING COUNT(DISTINCT cg.category_id) = ?
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/services/__tests__/search.integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/search.ts apps/api/src/services/__tests__/search.integration.test.ts
git commit -m "feat(search): apply gened any/all filtering"
```

---

### Task 4: Expand embeddings and FTS to include all GenEds

**Files:**
- Modify: `apps/api/src/services/embeddings.ts`
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/transforms/course.ts`
- Modify: `apps/api/src/services/parallel-sync.ts`
- Modify: `migrations/2026-01-20-schema-expansion.sql` (new migration)

**Step 1: Write the failing test**

```typescript
// Add a test to ensure gened_all text is present in embedding text and FTS.
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/services/__tests__/search.integration.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```sql
-- apps/api/src/db/schema.sql
ALTER TABLE courses ADD COLUMN gened_all TEXT;
```

```typescript
// apps/api/src/transforms/course.ts
// populate gened_all as space-separated unique codes from genEdCategories
```

```typescript
// apps/api/src/services/embeddings.ts
// include gened_all in createEmbeddingText
```

```sql
-- Update courses_fts to include gened_all and triggers
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/services/__tests__/search.integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/db/schema.sql apps/api/src/transforms/course.ts apps/api/src/services/embeddings.ts migrations/2026-01-20-schema-expansion.sql
git commit -m "feat(db): index all geneds for search and embeddings"
```

---

### Task 5: Surface explainability metadata

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

```typescript
// Add a response shape test to assert filters/sorts/disambiguation are returned.
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/search.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// apps/api/src/routes/search.ts
// Return filters, sort, availableSorts, availableFilters, disambiguation from plan
```

```tsx
// apps/web/src/App.tsx
// Render chips from filters and a simple sort dropdown
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/search.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/routes/search.ts apps/web/src/App.tsx
git commit -m "feat(ui): add explainability metadata and sorting"
```

---

### Task 6: Documentation

**Files:**
- Create: `docs/query-syntax.md`

**Step 1: Write documentation**

```markdown
# Query Syntax (v1)
- field:value filters
- quotes
- -negation
- OR clauses
- gened:any(...) and gened:all(...)
```

**Step 2: Commit**

```bash
git add docs/query-syntax.md
git commit -m "docs: add query syntax guide"
```

---

## Testing Summary

- `cd apps/api && npx vitest run src/services/__tests__/query-parser.test.ts`
- `cd apps/api && npx vitest run src/services/__tests__/query-resolver.test.ts`
- `cd apps/api && npx vitest run src/services/__tests__/search.integration.test.ts`
- `cd apps/api && npx vitest run src/routes/__tests__/search.test.ts`

---

## Notes

- Keep OR scope top-level only for v1.
- Use `gened:any(...)` / `gened:all(...)` to control multi-GenEd logic.
- Avoid breaking changes in Vectorize metadata; add metadata only if index supports it.
