# Search Relevance Overhaul Design

**Date:** 2026-01-22
**Status:** Approved

---

## Overview

A comprehensive search relevance overhaul addressing all identified issues plus measurement infrastructure. Single release targeting alpha users. Breaking changes are acceptable.

### Success Criteria

- MRR@10 improves from ~0.62 (estimated) to 0.80+
- Constraint violation rate drops from ~35% to <5%
- Zero-result rate stays stable or improves
- All 100+ proposed golden queries pass

### The 8 Fixes

1. Post-filter semantic results to enforce all constraints
2. Remove stop-phrases from residual ("gen ed", "sections", etc.)
3. Transparent fallback (indicate when constraints relaxed)
4. Cache subjects/gen-eds/topics for alias detection
5. Add exact-title match boost in ranking
6. Handle C++/special tokens in FTS sanitization
7. Make "intro" a boost, not a hard level filter
8. Extract explicit term mentions and filter to that term

### New Infrastructure

- Evaluation harness (MRR, violation rate, zero-result rate)
- Taxonomy cache (subjects, gen-eds, topics)
- Query logging (10% sample to D1)

### Out of Scope

- Range queries (`3-4 credits`, `after 2pm`)
- OR queries (`CS or ECE`)

---

## Evaluation Harness

### Purpose

Measure search quality before and after changes with concrete numbers.

### Metrics

1. **MRR@10 (Mean Reciprocal Rank)** - For queries with an expected top result, where does it actually rank? MRR = average of 1/rank. Score of 1.0 = perfect, 0.1 = target always at rank 10.

2. **Constraint Violation Rate** - For queries with invariants (e.g., `subject: CS`, `level_gte: 400`), what percentage of results violate them? Target: <5%.

3. **Zero-Result Rate** - What percentage of queries return nothing?

4. **Top-1 Accuracy** - When we specify an expected #1 result, how often is it actually #1?

### Implementation

```
apps/api/src/eval/
├── runner.ts        # Runs all golden queries, collects results
├── metrics.ts       # Calculates MRR, violations, etc.
├── golden-queries.ts # The 100+ test cases with expectations
└── report.ts        # Outputs before/after comparison
```

### Usage

```bash
cd apps/api && npm run eval
# Output:
# MRR@10: 0.62 → 0.81 (+30%)
# Violations: 34% → 3% (-91%)
# Zero-results: 8% → 6% (-25%)
# Top-1 accuracy: 45% → 72% (+60%)
```

Runs against local D1 database with real course data (not mocks).

---

## Taxonomy Cache

### Purpose

Cache subjects, gen-eds, and topics in Worker memory so extraction can detect multi-word names like "computer science" without per-request DB queries.

### Data Structure

```typescript
interface TaxonomyCache {
  subjects: {
    byCode: Map<string, { id: string; name: string }>;
    byAlias: Map<string, string>;  // lowercase alias → code
  };
  geneds: {
    byCode: Map<string, { code: string; name: string }>;
    byAlias: Map<string, string>;  // "humanities" → "HUM"
  };
  topics: Map<string, string>;  // "ai" → "artificial intelligence"
  loadedAt: number;
}
```

### Loading Strategy

- Load on first request (cold start)
- Refresh if `loadedAt` > 6 hours ago
- Single global variable (Workers keep globals alive within isolate)
- Term state NOT cached (changes more frequently, query per request)

### Source Tables

- `subjects` + `subject_aliases` → subjects cache
- New `gened_aliases` table (migrate from hardcoded `GENED_SYNONYMS`)
- New `topic_aliases` table (migrate from hardcoded `TOPIC_MAP`)

### Migration

Move hardcoded synonyms from `query-resolver.ts`, `alias-registry.ts`, and `topic-registry.ts` into D1 tables.

---

## Extraction Improvements

### Stop-Phrase Removal

After extracting hints, remove high-frequency generic tokens from residual:

```typescript
const STOP_PHRASES = [
  'gen ed', 'gened', 'gen-ed',
  'section', 'sections',
  'class', 'classes',
  'course', 'courses',
  'only', 'booster'
];
```

Applied after all other extraction, before returning residual.

### Subject Alias Detection

With the taxonomy cache, match multi-word names:

```
"computer science 225" → detect "computer science" → CS → {subject: CS, number: 225}
"comp sci 400 level" → detect "comp sci" → CS → {subject: CS, level: 400}
"psychology 100" → detect "psychology" → PSYC → {subject: PSYC, number: 100}
```

Match longest alias first to avoid partial matches.

### Term Extraction

New extraction pattern:

```typescript
const termRegex = /(spring|fall|summer|winter)\s*(20\d{2})/i;
// "spring 2026 CS" → {term: "spring", year: 2026}
```

### "intro" as Boost

Change `LEVEL_KEYWORDS` from producing hard filters to soft boosts. Store as `hints.levelBoost: 100` instead of `filters.level: 100`. Only apply as filter if no explicit level given.

---

## Enforcement Fixes

### Problem

Semantic channel only filters on `subject` and `level_bucket`, ignoring other constraints. Results that violate user intent leak into final ranking via RRF fusion.

### Solution: Post-Filter Semantic Results

```typescript
// After semantic search returns
let semanticResults = await semanticSearch(vectorize, ai, plan.semanticQuery, plan.filters, 50);

// Post-filter to enforce constraints semantic channel can't handle
if (Object.keys(plan.filters).length > 0) {
  const courseIds = semanticResults.map(r => r.id);
  const courses = await fetchCoursesWithGened(db, courseIds);

  semanticResults = semanticResults.filter(r => {
    const course = courses.get(r.id);
    if (!course) return false;

    if (plan.filters.gened_code && !course.geneds.includes(plan.filters.gened_code)) return false;
    if (plan.filters.credits && course.credit_hours !== plan.filters.credits) return false;
    if (plan.filters.difficulty === 'easy' && (course.avg_gpa || 0) < 3.5) return false;
    if (plan.filters.difficulty === 'hard' && (course.avg_gpa || 0) > 3.0) return false;
    // ... other filters

    return true;
  });
}
```

Trade-off: Adds one DB query to fetch course details for filtering. Bounded to max 50 courses.

---

## Ranking Improvements

### Exact-Title Match Boost

```typescript
// In hybridSearch, after RRF scoring
const queryLower = (plan.keywordQuery || '').toLowerCase().trim();

for (const item of scores) {
  const course = courseMap.get(item.id);
  if (!course) continue;

  const titleLower = course.title.toLowerCase();

  if (titleLower === queryLower) {
    item.score += 0.5;  // Exact match - strong boost
  } else if (titleLower.includes(queryLower) || queryLower.includes(titleLower)) {
    item.score += 0.2;  // Partial match - moderate boost
  }
}
```

### FTS Special Token Handling

```typescript
const SPECIAL_TOKENS: Record<string, string> = {
  'c++': 'cplusplus',
  'c#': 'csharp',
  '.net': 'dotnet',
  'f#': 'fsharp',
};

function sanitizeFtsQuery(query: string): string {
  let sanitized = query.toLowerCase();

  // Replace special tokens before stripping punctuation
  for (const [token, replacement] of Object.entries(SPECIAL_TOKENS)) {
    sanitized = sanitized.replace(new RegExp(escapeRegex(token), 'gi'), replacement);
  }

  // Then normal sanitization...
}
```

Note: Course descriptions should also be indexed with these replacements.

---

## Fallback Transparency

### Problem

When results are sparse, the system silently drops filters. Users don't know their constraints were relaxed.

### Solution: Track and Report Relaxed Constraints

```typescript
interface SearchPipelineResult {
  results: SearchResult[];
  meta: {
    // ... existing fields
    fallback: {
      tierReached: number;           // 1, 2, 3, or 4
      constraintsRelaxed: string[];  // ["level", "gened_code"]
      originalResultCount: number;   // How many before broadening
    };
  };
}
```

Frontend can show: "No exact matches for '400-level HUM gen-ed'. Showing all HUM gen-eds."

---

## Query Logging

### Schema

```sql
CREATE TABLE search_logs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  raw_query TEXT NOT NULL,

  -- Extraction results (JSON)
  hints_json TEXT,
  filters_json TEXT,
  residual TEXT,

  -- Execution info
  is_navigational INTEGER,
  tier_reached REAL,
  constraints_relaxed TEXT,  -- JSON array

  -- Results summary
  result_count INTEGER,
  top5_ids TEXT,  -- JSON array

  -- Performance
  total_ms INTEGER,

  -- For sampling
  sample_bucket INTEGER
);

CREATE INDEX idx_logs_timestamp ON search_logs(timestamp);
CREATE INDEX idx_logs_zero ON search_logs(result_count) WHERE result_count = 0;
```

### Sampling

```typescript
const SAMPLE_RATE = 0.10;  // 10%

function shouldLog(): boolean {
  return Math.random() < SAMPLE_RATE;
}
```

---

## Testing Strategy

### Three Layers

1. **Unit tests** - Expand existing test files for new functionality
2. **Golden query tests** - Expand from 11 → 100+ queries with invariants
3. **Evaluation harness** - `npm run eval` for before/after comparison

### Execution

```bash
# During development
npm test              # Unit + golden tests (fast, mocked)

# Before release
npm run eval          # Full evaluation against real data
```

---

## Implementation Order

### Phase 1: Foundation

1. Evaluation harness - Build `apps/api/src/eval/`
2. Expand golden queries - 11 → 100+ with invariants
3. DB migrations - `gened_aliases`, `topic_aliases`, `search_logs` tables

### Phase 2: Infrastructure

4. Taxonomy cache - Build loader, integrate into Worker globals
5. Query logging - 10% sampled logging

### Phase 3: Extraction Fixes

6. Stop-phrase removal
7. Subject alias detection using cache
8. Term extraction
9. "intro" as boost

### Phase 4: Enforcement + Ranking

10. Semantic post-filter
11. Exact-title boost
12. FTS special tokens

### Phase 5: Transparency

13. Fallback tracking

### Phase 6: Validate

14. Run eval harness - Compare before/after
15. Manual spot-check

---

## Files to Modify

### New Files

- `apps/api/src/eval/runner.ts`
- `apps/api/src/eval/metrics.ts`
- `apps/api/src/eval/golden-queries.ts`
- `apps/api/src/eval/report.ts`
- `apps/api/src/services/taxonomy-cache.ts`
- `migrations/003-gened-aliases.sql`
- `migrations/004-topic-aliases.sql`
- `migrations/005-search-logs.sql`

### Modified Files

- `apps/api/src/services/extractor.ts` - stop-phrases, subject aliases, term extraction, intro boost
- `apps/api/src/services/search.ts` - semantic post-filter, exact-title boost, FTS special tokens
- `apps/api/src/services/search-pipeline.ts` - fallback transparency, query logging
- `apps/api/src/services/query-resolver.ts` - use taxonomy cache
- `apps/api/src/services/__tests__/golden-queries.json` - expand to 100+
