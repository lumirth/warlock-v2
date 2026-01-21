# Smart Query Extraction & Search Improvements

**Date:** 2026-01-20
**Status:** Draft
**Author:** Brainstorming session

## Problem Statement

Two critical issues with the current search system:

1. **Search results are broken for course codes.** Searching "CS 225" returns CEE 201, PSYC 225, and other unrelated courses instead of the actual CS 225 course. The query extractor doesn't recognize subject + number patterns.

2. **Instructor schema incorrectly deduplicates.** The `UNIQUE(last_name, first_name)` constraint merges different instructors with the same name (e.g., two "Smith, J" from different departments).

## Goals

- "CS 225" returns CS 225 as the top result
- Support natural language queries like "easy morning gen ed"
- Recognize subjects by code, full name, and common abbreviations
- Handle instructor name collisions properly
- Disambiguate subject/gened conflicts (CS = Computer Science vs Cultural Studies)

## Non-Goals

- Full schedule builder integration
- Recommendation engine
- User accounts / saved searches

---

## Design

### 1. Query Extraction Pipeline

Replace the current regex-only extractor with a multi-stage pipeline using compromise.js for NLP.

```
User Input: "easy cs 225 morning MWF"
                    ↓
┌─────────────────────────────────────────┐
│ Stage 1: Pattern Extraction (regex)     │
│ - Course code: CS 225                   │
│ - Days: MWF                             │
│ - CRN: 5-digit numbers                  │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ Stage 2: NLP Extraction (compromise.js) │
│ - "easy" → difficulty filter            │
│ - "morning" → time filter               │
│ - "with fagen" → instructor             │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ Stage 3: Server Resolution              │
│ - Validate "CS" exists in subjects      │
│ - Resolve ambiguities (subject vs gened)│
│ - Map semantic terms to filters         │
└─────────────────────────────────────────┘
                    ↓
            Structured Search Plan
```

#### Course Code Pattern

Regex: `/\b([A-Z]{2,4})\s*(\d{3})\b/i`

Supported formats:
- `CS 225` (canonical)
- `cs 225` (lowercase)
- `CS225` / `cs225` (no space)

Not supported:
- `CS-225` (hyphen) - not a common pattern

#### Extracted Filter Types

| Type | Examples | Extraction Method |
|------|----------|-------------------|
| subject | CS, computer science | Regex + DB lookup |
| number | 225, 101 | Regex (with subject) |
| instructor | fagen, angrave | compromise.js + keywords |
| gened | humanities, QR1 | Keyword mapping |
| credits | 3 credits, 4 hours | Regex |
| level | 400 level, intro, advanced | Regex + keywords |
| days | MWF, tuesday thursday | Regex + NLP |
| time | morning, after 5pm | NLP + time parsing |
| difficulty | easy, hard | NLP keywords |
| online | online, in person | Keywords |
| status | open, available | Keywords |
| term | fall 2024, spring | Regex + NLP |
| crn | 12345 (5-digit) | Regex |

---

### 2. Subject Recognition

Server-side recognition with fallback hierarchy:

```
Input: "computer science"
         ↓
┌─────────────────────────────────────────┐
│ 1. Exact code match                     │
│    "cs" → subjects.id = "CS" ✓          │
└─────────────────────────────────────────┘
         ↓ (if no match)
┌─────────────────────────────────────────┐
│ 2. Full name match                      │
│    "computer science" → subjects.name   │
└─────────────────────────────────────────┘
         ↓ (if no match)
┌─────────────────────────────────────────┐
│ 3. Alias lookup                         │
│    "comp sci" → alias for CS            │
└─────────────────────────────────────────┘
         ↓ (if no match)
┌─────────────────────────────────────────┐
│ 4. Fuzzy match (Levenshtein ≤ 2)        │
│    "computr science" → CS               │
└─────────────────────────────────────────┘
```

#### Subject Aliases

Auto-generated from `subjects.name` field, plus manual overrides:

```typescript
const SUBJECT_ALIASES: Record<string, string[]> = {
  // Auto-generated from subjects.name
  "CS": ["computer science"],
  "ECE": ["electrical and computer engineering"],
  "MATH": ["mathematics"],

  // Manual overrides for common abbreviations
  "CS": ["comp sci", "compsci"],
  "ECE": ["ee", "electrical engineering"],
  "PHYS": ["physics"],
  "CHEM": ["chemistry"],
  "PHIL": ["philosophy"],
  // ... etc
};
```

#### Subject Source

The `subjects` table accumulates across all synced terms (union of all historical data). A subject recognized in any past term remains valid for search.

---

### 3. Subject/GenEd Disambiguation

Some codes conflict:
- `CS` = Computer Science (subject) OR Cultural Studies (gened)
- `PS` = Political Science (subject) OR Physical Sciences (gened)

#### Resolution Strategy: Context + Priority + Hint

**Step 1: Context inference**
```typescript
function inferFromContext(token: string, query: string): 'subject' | 'gened' | null {
  // Number present → subject
  if (/\b[A-Z]{2,4}\s*\d{3}\b/i.test(query)) return 'subject';

  // GenEd keywords nearby → gened
  if (/gened|requirement|fulfill|gen ed/i.test(query)) return 'gened';

  // Subject keywords nearby → subject
  if (/course|class|section/i.test(query)) return 'subject';

  return null; // Ambiguous
}
```

**Step 2: Priority (subject wins)**

If context doesn't resolve, default to subject interpretation.

**Step 3: Disambiguation hint**

Return alternative in API response:

```typescript
interface SearchResponse {
  results: Course[];
  interpretation: {
    filters: AppliedFilter[];
    ambiguities?: Ambiguity[];
  };
}

interface Ambiguity {
  term: string;              // "CS"
  chosen: FilterOption;      // { type: "subject", value: "CS", label: "Computer Science" }
  alternatives: FilterOption[];
}
```

Frontend displays: "Showing Computer Science. Did you mean Cultural Studies (GenEd)?"

---

### 4. GenEd Synonyms

Static mapping for natural language to GenEd codes:

```typescript
const GENED_SYNONYMS: Record<string, string[]> = {
  // Composition
  "CMP": ["comp 1", "composition", "writing", "rhet 105", "freshman comp"],
  "ACP": ["adv comp", "advanced composition", "advanced comp", "writing intensive"],

  // Humanities & Arts
  "HUM": ["humanities", "humanities and the arts", "arts"],
  "HP": ["historical", "philosophical", "history", "philosophy"],
  "LA": ["literature", "lit", "literature and the arts"],

  // Natural Sciences
  "NAT": ["nat sci", "natural sciences", "science", "natural sciences and technology"],
  "PS": ["physical sciences", "physical", "physics", "chem"],
  "LS": ["life sciences", "life sci", "bio", "biology"],

  // Social & Behavioral Sciences
  "SBS": ["social science", "behavioral science", "social and behavioral"],
  "SS": ["social", "soc sci"],
  "BSC": ["behavioral", "psych", "psychology"],

  // Cultural Studies
  "CS": ["cultural studies", "cultural"],
  "NW": ["non-western", "non western", "nonwestern"],
  "US": ["us minority", "minority cultures", "us minority cultures"],
  "WCC": ["western", "comparative", "western comparative"],

  // Quantitative Reasoning
  "QR": ["quantitative", "quant", "quantitative reasoning"],
  "QR1": ["qr1", "qr 1", "quant 1", "quantitative reasoning 1"],
  "QR2": ["qr2", "qr 2", "quant 2", "quantitative reasoning 2"],
};
```

---

### 5. Difficulty Filtering

"Easy" and "hard" map to combined GPA + RMP difficulty filters:

```typescript
const DIFFICULTY_FILTERS = {
  easy: {
    min_gpa: 3.5,
    max_rmp_difficulty: 3.0,
  },
  hard: {
    max_gpa: 3.0,
    min_rmp_difficulty: 4.0,
  },
};
```

Query: `WHERE avg_gpa >= 3.5 AND primary_instructor_rmp_difficulty <= 3.0`

---

### 6. Time-Based Filtering

#### Time of Day

```typescript
const TIME_RANGES = {
  morning: { start: "00:00", end: "12:00" },
  afternoon: { start: "12:00", end: "17:00" },
  evening: { start: "17:00", end: "23:59" },
  night: { start: "17:00", end: "23:59" }, // alias for evening
};
```

#### Days Pattern

Recognize common patterns:
- `MWF`, `mwf` → Monday, Wednesday, Friday
- `TR`, `tu th`, `tuesday thursday` → Tuesday, Thursday
- Individual days: `monday`, `mon`, `M`

SQL: `WHERE days LIKE '%M%' AND days LIKE '%W%' AND days LIKE '%F%'`

---

### 7. Instructor Schema Changes

#### Problem

Current schema merges different people with same name:

```sql
CREATE UNIQUE INDEX idx_instructors_name ON instructors(last_name, first_name);
```

#### Solution

Remove uniqueness constraint, link instructors to specific sections:

```sql
-- Remove unique index
DROP INDEX IF EXISTS idx_instructors_name;

-- Add non-unique search index
CREATE INDEX IF NOT EXISTS idx_instructors_search
  ON instructors(last_name, first_name);
```

#### Implications

- `upsertInstructor()` changes from "find or create unique" to "create per section"
- Stats (GPA, RMP) stored per instructor record
- Display: aggregate by name match for now
- Future: proper instructor identity resolution (matching to RMP/GPA sources)

---

### 8. FTS Index Strategy

#### Current: courses_fts

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
    subject,
    number,
    title,
    description,
    primary_instructor,
    gened,
    content='courses',
    content_rowid='rowid',
    tokenize='trigram'
);
```

#### New: sections_fts

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
    section_title,    -- Topics course titles ("Cloud Computing")
    instructor,       -- Section-specific instructor
    section_text,     -- Detailed info
    section_notes,    -- Restrictions
    content='sections',
    content_rowid='rowid',
    tokenize='trigram'
);

-- Triggers to keep in sync
CREATE TRIGGER IF NOT EXISTS sections_fts_insert AFTER INSERT ON sections BEGIN
    INSERT INTO sections_fts(rowid, section_title, instructor, section_text, section_notes)
    VALUES (new.rowid, new.section_title, new.instructor, new.section_text, new.section_notes);
END;

CREATE TRIGGER IF NOT EXISTS sections_fts_delete AFTER DELETE ON sections BEGIN
    INSERT INTO sections_fts(sections_fts, rowid, section_title, instructor, section_text, section_notes)
    VALUES('delete', old.rowid, old.section_title, old.instructor, old.section_text, old.section_notes);
END;

CREATE TRIGGER IF NOT EXISTS sections_fts_update AFTER UPDATE ON sections BEGIN
    INSERT INTO sections_fts(sections_fts, rowid, section_title, instructor, section_text, section_notes)
    VALUES('delete', old.rowid, old.section_title, old.instructor, old.section_text, old.section_notes);
    INSERT INTO sections_fts(rowid, section_title, instructor, section_text, section_notes)
    VALUES (new.rowid, new.section_title, new.instructor, new.section_text, new.section_notes);
END;
```

#### Search Flow

```
Query: "cloud computing with fagen"
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
courses_fts         sections_fts
    ↓                   ↓
course_ids          section CRNs → course_ids
    └─────────┬─────────┘
              ↓
         Union IDs
              ↓
      Apply SQL filters
              ↓
        RRF fusion ranking
              ↓
          Results
```

---

### 9. Term Prioritization

Terms are ranked by relevance to what students are actively registering for:

#### Priority Order

```
1. Latest registrable term (what you're signing up for next)
2. Currently active term (what you're taking now)
3. Historical terms, with Fall/Spring preferred over Winter/Summer
4. Within same priority, more recent first
```

#### Example (Current: Fall 2025, Spring 2026 registration open)

| Rank | Term | Reason |
|------|------|--------|
| 1 | Spring 2026 | Registration open, latest |
| 2 | Fall 2025 | Currently active |
| 3 | Spring 2025 | Historical, Fall/Spring preferred |
| 4 | Fall 2024 | Historical, Fall/Spring preferred |
| 5 | Summer 2025 | Historical, but Summer ranked lower |
| 6 | Winter 2025 | Historical, Winter ranked lowest |

#### Implementation

```typescript
function getTermPriority(term: TermState, activeTerm: string, registrableTerm: string): number {
  const seasonRank = { fall: 1, spring: 1, summer: 2, winter: 2 };

  // Registrable term is highest priority
  if (term.term_id === registrableTerm) return 0;

  // Active term is second priority
  if (term.term_id === activeTerm) return 1;

  // Historical: Fall/Spring before Winter/Summer, then by recency
  const base = 100 - term.year; // More recent = lower number
  const seasonPenalty = seasonRank[term.term] === 2 ? 50 : 0;

  return 2 + base + seasonPenalty;
}

async function searchWithTermRanking(filters: SearchFilters) {
  // Search across all terms
  let results = await search({ ...filters, term: null });

  // Sort by term priority, then by relevance score
  results.sort((a, b) => {
    const termDiff = getTermPriority(a) - getTermPriority(b);
    if (termDiff !== 0) return termDiff;
    return b._score - a._score;
  });

  // Label non-current results
  const currentTerms = [activeTerm, registrableTerm];
  results = results.map(r => ({
    ...r,
    historical: !currentTerms.includes(r.term_id),
  }));

  return results;
}
```

#### Term State Detection

The `term_state` table tracks which terms are active vs historical:

```sql
SELECT term_id, status FROM term_state
WHERE status IN ('active', 'registrable')
ORDER BY year DESC,
  CASE term WHEN 'spring' THEN 1 WHEN 'fall' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END;
```

---

## Priority & User Stories

### P0 - Must work perfectly

| User Story | Example Query |
|------------|---------------|
| Find specific course | "CS 225", "cs225", "computer science 225" |
| Find by keyword | "data structures", "machine learning" |
| Find by instructor | "with fagen", "professor angrave" |
| Find GenEds | "humanities gened", "need a QR1" |
| Current term default | "CS 225" (assumes current term) |

### P1 - Should work well

| User Story | Example Query |
|------------|---------------|
| Specific term | "CS 225 fall 2024", "spring classes" |
| Credit hours | "3 credit courses", "4 hour class" |
| Course level | "400 level", "intro courses", "advanced" |
| Schedule: days | "MWF", "tuesday thursday" |
| Schedule: time | "morning classes", "after 5pm" |
| Open sections | "open sections", "available" |
| Online/in-person | "online only", "in person" |

### P2 - Nice to have

| User Story | Example Query |
|------------|---------------|
| CRN lookup | "12345", "CRN 67890" |
| Difficulty | "easy gen ed", "hard CS classes" |
| Part of term | "first half", "8 week course" |
| Multiple GenEds | "counts for HUM and CS-NW" |
| Combined filters | "easy 3 credit morning humanities" |

### P3 - Skip for now

- "Classes that fit my schedule" (requires user schedule)
- Keyword type selection (exact phrase vs any words)

---

## Implementation Plan

### Phase 1: Fix Course Code Recognition
1. Add subject + number regex pattern to extractor
2. Server-side subject validation against `subjects` table
3. Exact match query for recognized course codes
4. Test: "CS 225" returns CS 225 as top result

### Phase 2: Add sections_fts
1. Create sections_fts virtual table
2. Add sync triggers
3. Backfill existing sections
4. Update search to query both FTS tables

### Phase 3: Instructor Schema Fix
1. Remove UNIQUE constraint
2. Update upsertInstructor() logic
3. Aggregate stats by name for display

### Phase 4: NLP Extraction (compromise.js)
1. Add compromise.js dependency
2. Implement NLP extraction for difficulty, time, instructor
3. Integrate with existing pipeline

### Phase 5: Subject Aliases & GenEd Synonyms
1. Build alias mapping from subjects.name
2. Add manual overrides for common abbreviations
3. Implement GenEd synonym resolution

### Phase 6: Disambiguation
1. Implement context inference
2. Add ambiguity field to API response
3. Frontend renders disambiguation hints

---

## Dependencies

- **compromise.js** - NLP library for natural language extraction
- Existing: D1, Vectorize, FTS5

## Risks

| Risk | Mitigation |
|------|------------|
| compromise.js bundle size | Tree-shake; only import needed plugins |
| FTS query performance with two tables | Parallel queries; both are fast |
| Alias maintenance burden | Auto-generate from subjects.name; minimal manual list |

---

## Success Metrics

1. "CS 225" returns CS 225 as #1 result
2. "easy gen ed" returns courses with high GPA + low difficulty
3. Topics courses searchable by section title
4. No instructor data loss from name collisions
