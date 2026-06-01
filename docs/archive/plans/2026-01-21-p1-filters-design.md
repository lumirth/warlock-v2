# P1 Filters Design

**Date:** 2026-01-21
**Status:** Approved
**Goal:** Complete the P1 filter tier for schedule, availability, and course attribute filtering.

---

## 1. Overview & Goals

This spec completes the P1 filter tier for the UIUC Course Search engine. Users can filter by schedule constraints (days, time), delivery mode (online/in-person), availability (open sections), course attributes (credits, level), and difficulty.

**Goals:**
- "MWF morning gen eds" returns gen eds with MWF sections starting before noon
- "easy 3 credit online" returns online courses with 3 credits and high GPA
- "open 400 level CS" returns CS courses at 400-level with available sections
- Filters combine with existing search (subject, instructor, gened, keywords)

**Non-goals:**
- Schedule conflict detection
- Section-level search results (courses only, with section metadata)
- Real-time seat availability (uses synced data)

---

## 2. Extractor Changes

Two new extraction patterns added to `query-extractor-lite`:

**Credits extraction:**
```
Patterns: "3 credit", "3 credits", "4 hour", "4 hours", "3 cr", "3-credit"
Regex: /\b(\d)\s*(?:credit|credits|cr|hour|hours)s?\b/gi
Output: { type: 'credits', value: '3', confidence: 0.8 }
```

**Level extraction:**
```
Numeric: "400 level", "400-level", "100 level courses"
Regex: /\b([1-5])00\s*-?\s*level\b/gi
Output: { type: 'level', value: '400', confidence: 0.9 }

Semantic: "intro", "introductory", "advanced", "graduate", "upper level"
Keywords:
  intro/introductory → '100'
  advanced/upper level → '400'
  graduate/grad level → '500'
Output: { type: 'level', value: '100', confidence: 0.7 }
```

**Updated time extraction:**
```
Current: morning, afternoon, evening, night
Add: early, early morning, midday
Keywords:
  early/early morning → 'early'
  midday → 'midday'
```

**Updated status extraction:**
```
Current: open, available → 'open'
Change:
  open → 'open' (strict)
  available → 'available' (includes restricted)
```

All other extractions (days, online, difficulty) remain unchanged.

---

## 3. Resolver Changes

The resolver (`query-resolver.ts`) handles database resolution only. The new filter types require no DB lookups, so they pass through unchanged.

**New hint types to pass through:**

```typescript
case 'days':
  plan.filters.days = hint.value;  // "MWF", "TR", etc.
  break;

case 'time':
  plan.filters.time = hint.value;  // "morning", "early", "midday", etc.
  break;

case 'level':
  plan.filters.level = hint.value;  // "100", "400", "intro", etc.
  break;

case 'credits':
  plan.filters.credits = parseInt(hint.value);  // 3, 4, etc.
  break;

case 'online':
  plan.filters.online = hint.value === 'true';  // boolean
  break;

case 'status':
  plan.filters.status = hint.value;  // "open" or "available"
  break;

case 'difficulty':
  plan.filters.difficulty = hint.value;  // "easy" or "hard"
  break;
```

**SearchFilters type update:**

```typescript
export interface SearchFilters {
  // Existing
  instructor_ids?: number[];
  gened_code?: string;
  subject?: string;
  number?: string;
  crn?: string;

  // New
  days?: string;
  time?: string;
  level?: string;
  credits?: number;
  online?: boolean;
  status?: string;
  difficulty?: string;
}
```

The resolver's core logic (subject validation, instructor lookup, gened mapping, disambiguation) remains unchanged.

---

## 4. Search Execution

The `search.ts` file interprets semantic filters and builds SQL queries. This is where the constants and filter logic live.

**Constants:**

```typescript
const TIME_RANGES: Record<string, { start?: string; end?: string }> = {
  'early': { end: '09:00' },
  'morning': { end: '12:00' },
  'midday': { start: '10:00', end: '14:00' },
  'afternoon': { start: '12:00', end: '17:00' },
  'evening': { start: '17:00' },
};

const LEVEL_MAP: Record<string, number> = {
  'intro': 100,
  'introductory': 100,
  'advanced': 400,
  'upper': 400,
  'graduate': 500,
  'grad': 500,
};

const DIFFICULTY_FILTERS = {
  easy: { min_gpa: 3.5, max_rmp_difficulty: 3.0 },
  hard: { max_gpa: 3.0, min_rmp_difficulty: 4.0 },
};

const STATUS_VALUES: Record<string, string[]> = {
  'open': ['Open'],
  'available': ['Open', 'Restricted'],
};
```

**Filter application in keywordSearch():**

New filters require joining to sections/meetings tables. We track which sections match for the response metadata.

```typescript
// Days filter - exact match on meeting days
if (filters.days) {
  joins.add('sections');
  joins.add('meetings');
  whereClauses.push('m.days = ?');
  params.push(filters.days);
}

// Time filter - meeting start_time within range
if (filters.time) {
  const range = TIME_RANGES[filters.time];
  joins.add('sections');
  joins.add('meetings');
  if (range.start) {
    whereClauses.push('m.start_time >= ?');
    params.push(range.start);
  }
  if (range.end) {
    whereClauses.push('m.start_time < ?');
    params.push(range.end);
  }
}

// Level filter - derived from course number
if (filters.level) {
  const levelNum = LEVEL_MAP[filters.level] ?? parseInt(filters.level);
  whereClauses.push('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 = ?');
  params.push(levelNum);
}

// Credits filter - exact match
if (filters.credits) {
  whereClauses.push('c.credit_hours = ?');
  params.push(filters.credits);
}

// Online filter - check meeting location
if (filters.online !== undefined) {
  joins.add('sections');
  joins.add('meetings');
  if (filters.online) {
    whereClauses.push("(m.building_name = '' OR m.building_name IS NULL OR LOWER(m.building_name) LIKE '%online%')");
  } else {
    whereClauses.push("m.building_name != '' AND m.building_name IS NOT NULL AND LOWER(m.building_name) NOT LIKE '%online%'");
  }
}

// Status filter - section enrollment status
if (filters.status) {
  joins.add('sections');
  const statuses = STATUS_VALUES[filters.status] ?? ['Open'];
  const placeholders = statuses.map(() => '?').join(',');
  whereClauses.push(`s.status IN (${placeholders})`);
  params.push(...statuses);
}

// Difficulty filter - GPA and RMP thresholds
if (filters.difficulty) {
  const diff = DIFFICULTY_FILTERS[filters.difficulty];
  if (diff.min_gpa) {
    whereClauses.push('c.avg_gpa >= ?');
    params.push(diff.min_gpa);
  }
  if (diff.max_gpa) {
    whereClauses.push('c.avg_gpa <= ?');
    params.push(diff.max_gpa);
  }
  if (diff.min_rmp_difficulty) {
    whereClauses.push('c.difficulty_score >= ?');
    params.push(diff.min_rmp_difficulty);
  }
  if (diff.max_rmp_difficulty) {
    whereClauses.push('c.difficulty_score <= ?');
    params.push(diff.max_rmp_difficulty);
  }
}
```

**Join management:**

```typescript
const joins = new Set<string>();
// ... filter logic adds to joins ...

let joinClause = '';
if (joins.has('sections')) {
  joinClause += 'JOIN sections s ON s.course_id = c.id ';
}
if (joins.has('meetings')) {
  joinClause += 'JOIN meetings m ON m.section_crn = s.crn ';
}
```

---

## 5. Response Metadata

When section-level filters are applied, the response includes metadata about which sections matched.

**New fields in SearchResult:**

```typescript
export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  termPriority?: number;
  historical?: boolean;

  // New: section match metadata
  matchingSections?: number;
  matchingCrns?: string[];
}
```

**Collecting matching sections:**

When any section-level filter is active (days, time, online, status), we need a secondary query to get matching CRNs per course.

```typescript
async function getMatchingSections(
  db: D1Database,
  courseIds: string[],
  filters: SearchFilters
): Promise<Map<string, string[]>> {
  // Build WHERE clause for section/meeting filters only
  // Returns map of courseId → [crn, crn, ...]
}
```

**Hydration in hybridSearch:**

```typescript
// After getting course results...
const hasSectionFilters = filters.days || filters.time ||
  filters.online !== undefined || filters.status;

if (hasSectionFilters) {
  const matchingMap = await getMatchingSections(db, courseIds, filters);

  results = results.map(r => ({
    ...r,
    matchingSections: matchingMap.get(r.course.id)?.length ?? 0,
    matchingCrns: matchingMap.get(r.course.id) ?? []
  }));
}
```

**API response:**

```json
{
  "results": [
    {
      "subject": "CS",
      "number": "225",
      "title": "Data Structures",
      "_score": 0.95,
      "_matchingSections": 3,
      "_matchingCrns": ["12345", "12346", "12347"]
    }
  ],
  "meta": {
    "plan": { ... },
    "extracted": { ... }
  }
}
```

Frontend can use `_matchingCrns` to highlight or filter the section list when displaying course details.

---

## 6. Testing Strategy

**Unit tests for extractor (`query-extractor-lite`):**

```typescript
describe('credits extraction', () => {
  it('extracts "3 credit"', () => { ... });
  it('extracts "4 credits"', () => { ... });
  it('extracts "3 hour"', () => { ... });
  it('extracts "3-credit"', () => { ... });
});

describe('level extraction', () => {
  it('extracts "400 level"', () => { ... });
  it('extracts "400-level"', () => { ... });
  it('extracts "intro" as 100', () => { ... });
  it('extracts "advanced" as 400', () => { ... });
  it('extracts "graduate" as 500', () => { ... });
});

describe('time extraction additions', () => {
  it('extracts "early morning" as early', () => { ... });
  it('extracts "midday"', () => { ... });
});

describe('status extraction', () => {
  it('extracts "open" as open', () => { ... });
  it('extracts "available" as available', () => { ... });
});
```

**Unit tests for resolver (`query-resolver.ts`):**

```typescript
describe('new filter passthrough', () => {
  it('passes days filter unchanged', () => { ... });
  it('passes time filter unchanged', () => { ... });
  it('passes level filter unchanged', () => { ... });
  it('converts credits to number', () => { ... });
  it('converts online to boolean', () => { ... });
  it('passes status filter unchanged', () => { ... });
  it('passes difficulty filter unchanged', () => { ... });
});
```

**Unit tests for search (`search.ts`):**

```typescript
describe('time range interpretation', () => {
  it('morning filters start_time < 12:00', () => { ... });
  it('early filters start_time < 09:00', () => { ... });
  it('midday filters 10:00-14:00', () => { ... });
  it('afternoon filters 12:00-17:00', () => { ... });
  it('evening filters start_time >= 17:00', () => { ... });
});

describe('level interpretation', () => {
  it('numeric level filters by course number prefix', () => { ... });
  it('intro maps to 100', () => { ... });
  it('advanced maps to 400', () => { ... });
});

describe('difficulty interpretation', () => {
  it('easy filters avg_gpa >= 3.5, difficulty_score <= 3.0', () => { ... });
  it('hard filters avg_gpa <= 3.0, difficulty_score >= 4.0', () => { ... });
});

describe('section matching', () => {
  it('returns courses with at least one matching section', () => { ... });
  it('populates matchingSections count', () => { ... });
  it('populates matchingCrns array', () => { ... });
});

describe('filter combinations', () => {
  it('ANDs all filters together', () => { ... });
  it('ANDs days and time within same meeting', () => { ... });
});
```

**Integration tests:**

Unskip and expand `search.integration.test.ts` with real D1 queries to verify end-to-end behavior.

---

## 7. Implementation Order

**Phase 1: Extractor updates**
1. Add credits extraction pattern
2. Add level extraction (numeric + semantic)
3. Add early/midday time keywords
4. Split open/available status
5. Add tests, verify existing tests pass

**Phase 2: Resolver updates**
1. Add switch cases for new hint types
2. Update SearchFilters type in query-types package
3. Add passthrough tests

**Phase 3: Search execution**
1. Add constants (TIME_RANGES, LEVEL_MAP, DIFFICULTY_FILTERS, STATUS_VALUES)
2. Implement join management (avoid duplicate joins)
3. Add filter clauses for each new filter type
4. Implement getMatchingSections() helper
5. Add matchingSections/matchingCrns to response
6. Add unit tests for each filter

**Phase 4: Integration**
1. Unskip and expand integration tests
2. Test combined filter scenarios
3. Verify with real data (manual testing against deployed API)

**Dependencies:**
- Difficulty filter requires avg_gpa/difficulty_score data (will return empty until populated)
- Online detection depends on CISAPI buildingName format (verify with real data)
- Status filter depends on enrollmentStatus values (verify: "Open", "Closed", "Restricted")

**Estimated scope:**
- Extractor: ~50 lines new code
- Resolver: ~30 lines new code
- Search: ~150 lines new code
- Tests: ~200 lines new tests
