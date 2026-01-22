# Unified Query System Design

**Date:** 2026-01-22
**Status:** Draft
**Supersedes:**
- 2026-01-21-search-query-language-v1-plan.md
- 2026-01-21-p1-filters-design.md
- 2026-01-22-isomorphic-extractor-design.md

---

## 1. Executive Summary

This document specifies a unified query processing system for UIUC Course Search. The system follows a **layman-first philosophy**: users type natural language, the system extracts structure server-side, and results come back with explainability metadata.

**Core principles:**
1. **Server-only extraction** — No client-side query processing
2. **Semantic-first** — Default to search, not filtering
3. **Filters only when obvious** — Schedule, credits, availability, difficulty
4. **Suggestions over guesses** — Ambiguous terms get suggestions, not forced interpretations
5. **Deterministic aliases** — Dictionary matching, not NLP magic

**What this system handles:**
- Natural language queries: "easy cs gen ed with fagen"
- Structured filters: days, time, credits, level, online, status, difficulty
- Power-user syntax: `gened:HUM`, `gened:any(HUM,US)`, `-calculus`
- Instructor mentions: "with Fleck", "Dr. Margaret Fleck"
- Ambiguity resolution: "CS" as subject vs Cultural Studies gened

**What this system does NOT handle:**
- Client-side preview chips (not needed)
- Real-time extraction as user types (not needed)
- Schedule conflict detection (out of scope)
- Section-level search results (courses only, with section metadata)

---

## 2. Architecture Overview

### 2.1 Why Server-Only?

The previous plans explored client-side extraction for "instant preview chips." After analysis, this adds complexity without meaningful UX benefit:

| Approach | Pros | Cons |
|----------|------|------|
| **Server-only** | Single codebase, no version drift, zero bundle impact, simpler testing | Chips appear after search (~150ms) |
| **Hybrid** | Chips appear as you type (~8ms) | Two extractors, version drift risk, +30KB bundle, maintenance burden |
| **Isomorphic** | Same code everywhere | +250KB bundle (Compromise NLP), CPU waste (extract twice), V8 version issues |

**Decision:** Server-only. Users don't need to see chips until results arrive. The 150ms latency is imperceptible.

### 2.2 System Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           QUERY PROCESSING FLOW                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. USER INPUT                                                           │
│     "easy cs gen ed with fagen no mornings"                             │
│           │                                                              │
│           ▼                                                              │
│  2. QUERY PARSER (power-user syntax)                                    │
│     Extracts: field:value, gened:any/all, -negations, "phrases"         │
│     Output: ParsedQuery { filters, negations, phrases, residual }       │
│           │                                                              │
│           ▼                                                              │
│  3. EXTRACTOR (natural language)                                        │
│     Phase 1: Regex patterns (course codes, days, credits, etc.)         │
│     Phase 2: Alias matching (subject names, gened names, etc.)          │
│     Phase 3: Compromise NLP (instructors, negation phrases)             │
│     Output: Hint[] with spans, confidence, source                       │
│           │                                                              │
│           ▼                                                              │
│  4. DISAMBIGUATOR                                                        │
│     Applies context rules (e.g., "CS" near "gen ed" = Cultural Studies) │
│     Generates suggestions for ambiguous terms                            │
│     Output: ResolvedHints + Suggestions                                  │
│           │                                                              │
│           ▼                                                              │
│  5. RESOLVER (database validation)                                       │
│     Validates subjects exist, resolves instructor names to IDs          │
│     Maps gened synonyms to canonical codes                               │
│     Output: SearchPlan { filters, semanticQuery, keywordQuery }         │
│           │                                                              │
│           ▼                                                              │
│  6. SEARCH EXECUTION                                                     │
│     Parallel: FTS (keyword) + Vectorize (semantic)                      │
│     Merge with RRF, apply filters, rank by term priority                │
│     Output: SearchResult[]                                               │
│           │                                                              │
│           ▼                                                              │
│  7. RESPONSE                                                             │
│     { results, meta: { hints, filters, suggestions, residual } }        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Component Responsibilities

| Component | Responsibility | Input | Output |
|-----------|---------------|-------|--------|
| **Query Parser** | Extract power-user syntax | Raw query string | ParsedQuery |
| **Extractor** | Extract natural language hints | Residual text | Hint[] |
| **Alias Registry** | Deterministic phrase→entity mapping | Text spans | Alias matches |
| **Disambiguator** | Apply context rules, generate suggestions | Hints + context | Resolved hints |
| **Resolver** | Validate against DB, resolve IDs | Hints | SearchPlan |
| **Search** | Execute FTS + semantic, apply filters | SearchPlan | Results |

---

## 3. The Layman-First Philosophy

### 3.1 What Laymen Type

Users don't know:
- GenEd codes (HUM, NAT, SBS)
- Subject abbreviations (CS, ECE, MATH)
- That "open" vs "restricted" exists
- How to express time constraints formally

Users do know:
- Topic words: "psychology", "computer science", "writing"
- Requirements: "gen ed", "humanities", "science requirement"
- Life constraints: "no mornings", "online", "easy", "3 credits"
- Names: "with Fleck", "Fagen's class"

### 3.2 The Default Behavior

**Semantic-first:** Unless a phrase is clearly a constraint, treat it as search terms.

| Query | Interpretation |
|-------|---------------|
| `data structures` | Semantic search for "data structures" |
| `intro to psychology` | Semantic search, maybe level=100 hint |
| `machine learning` | Semantic search |
| `humanities` | Semantic search + suggestion "Filter by GenEd: HUM?" |
| `humanities gen ed` | Filter: gened_code=HUM |
| `MWF morning` | Filter: days=MWF, time=morning |
| `easy 3 credit online` | Filter: difficulty=easy, credits=3, online=true |

### 3.3 The Constraint Language

These phrases become filters (not semantic search):

| Category | Trigger phrases | Filter |
|----------|-----------------|--------|
| **Days** | MWF, TR, "tuesday thursday" | days |
| **Time** | morning, afternoon, evening, early, midday | time |
| **Negated time** | "no mornings", "not early", "avoid 8am" | not.time |
| **Credits** | "3 credits", "4 credit hours" | credits |
| **Level** | "400 level", "intro", "advanced", "graduate" | level |
| **Online** | "online", "remote", "in person" | online |
| **Status** | "open", "available", "has seats" | status |
| **Difficulty** | "easy", "hard", "gpa booster" | difficulty |
| **GenEd** | "[name] gen ed", "[name] requirement" | gened_code |

Everything else stays as semantic search terms.

### 3.4 Ambiguity Handling

Some terms are ambiguous. Instead of guessing, we:
1. Default to the safer interpretation (usually semantic)
2. Attach a suggestion for the alternative

| Query | Default | Suggestion |
|-------|---------|------------|
| `humanities` | Semantic search | "Filter by GenEd: Humanities & Arts?" |
| `CS 225` | Course code filter | (none, unambiguous) |
| `CS gen ed` | GenEd: Cultural Studies | (none, has cue) |
| `computer science` | Subject filter | "Search broadly without subject filter?" |

**The cue rule:** GenEd name-to-code mapping only activates when accompanied by a cue word: "gen ed", "gened", "requirement", "category".

---

## 4. Query Parser (Power-User Syntax)

### 4.1 Purpose

Support advanced users who want explicit control. This layer runs first and extracts structured syntax before natural language processing.

### 4.2 Supported Syntax

| Syntax | Example | Meaning |
|--------|---------|---------|
| `field:value` | `gened:HUM` | Explicit filter |
| `gened:any(...)` | `gened:any(HUM,US)` | Course has ANY of these geneds |
| `gened:all(...)` | `gened:all(NW,US)` | Course has ALL of these geneds |
| `-term` | `-calculus` | Exclude from results |
| `"phrase"` | `"data structures"` | Exact phrase match |
| `term OR term` | `CS 225 OR ECE 120` | Either clause (top-level only) |

### 4.3 Design Decisions

**Why `gened:any/all` instead of comma-separated?**

Students often need courses satisfying multiple requirements. The explicit `any`/`all` syntax makes intent clear:
- `gened:any(HUM,US)` — "I need one more gen ed, either works"
- `gened:all(NW,US)` — "I need a course that counts for both"

**Why top-level OR only?**

Nested boolean logic adds complexity without proportional value. Most users want simple alternatives ("this course or that course"), not complex boolean expressions. We can add nesting later if needed.

**Why `-negation` prefix?**

Follows Google convention. Users already know this syntax.

### 4.4 Output Shape

```typescript
interface ParsedQuery {
  raw: string;                    // Original query
  clauses: ParsedClause[];        // Split by top-level OR
}

interface ParsedClause {
  filters: FieldFilter[];         // field:value pairs
  negations: string[];            // -prefixed terms
  phrases: string[];              // "quoted phrases"
  genedMode?: {
    any?: string[];               // gened:any(...)
    all?: string[];               // gened:all(...)
  };
  residual: string;               // Remaining text for extraction
}

interface FieldFilter {
  field: string;
  value: string;
  negated?: boolean;
}
```

### 4.5 Trade-offs

| Upside | Downside |
|--------|----------|
| Power users get precise control | Two parsing systems (structured + NL) |
| Google-familiar syntax | Must document the syntax |
| Extensible (add fields later) | Slightly more complex pipeline |

**Mitigation:** Power-user syntax is optional. Natural language works fine without it.

---

## 5. Extraction System

### 5.1 Purpose

Extract structured hints from natural language text (the residual after query parsing).

### 5.2 Three-Phase Extraction

Extraction runs in phases, most specific to least specific:

**Phase 1: Regex Patterns (Structured Data)**
- Course codes: `CS 225`, `math241`, `ECE 120`
- CRNs: `12345`, `CRN 54321`
- Credit hours: `3 credits`, `4 hour`
- Semester: `fall 2025`, `spring semester`
- Days: `MWF`, `TR`, `tuesday thursday`

**Phase 2: Alias Matching (Known Entities)**
- Subject names: `computer science` → CS
- GenEd names: `humanities` → HUM (only with cue)
- Time keywords: `morning`, `afternoon`, `early`
- Status keywords: `open`, `available`
- Difficulty keywords: `easy`, `hard`, `gpa booster`
- Delivery keywords: `online`, `in person`

**Phase 3: Compromise NLP (Linguistic Patterns)**
- Instructor mentions: `with Fagen`, `Dr. Margaret Fleck`, `taught by`
- Negation phrases: `not morning`, `avoid early`, `no 8ams`
- Vague intent: `something about AI` (low confidence, mostly residual)

### 5.3 Why This Order?

1. **Regex first** — Catches unambiguous structured data before anything else can claim it
2. **Aliases second** — Known entities matched deterministically
3. **NLP third** — Catches patterns that require linguistic understanding

If NLP ran first, it might incorrectly parse "CS 225" as a person's initials.

### 5.4 Hint Structure

```typescript
interface Hint {
  type: HintType;
  value: string | number | boolean | NegationValue;
  metadata: HintMetadata;
}

type HintType =
  | 'courseCode'
  | 'crn'
  | 'subject'
  | 'instructor'
  | 'days'
  | 'time'
  | 'level'
  | 'credits'
  | 'online'
  | 'status'
  | 'difficulty'
  | 'gened'
  | 'semester'
  | 'negation';

interface HintMetadata {
  source: 'regex' | 'alias' | 'nlp';
  span: [number, number];      // Start/end in residual text
  confidence: number;          // 0-1
  raw: string;                 // Original matched text
}

interface NegationValue {
  target: HintType;            // What's being negated
  value: string;               // The negated value
}
```

### 5.5 Confidence Levels

| Source | Typical Confidence | Rationale |
|--------|-------------------|-----------|
| Regex (course code) | 0.95 | Unambiguous pattern |
| Regex (CRN) | 0.90 | Could be other 5-digit numbers |
| Alias (exact match) | 0.90 | Deterministic |
| Alias (partial match) | 0.70 | Less certain |
| NLP (instructor) | 0.80 | Usually correct but can miss |
| NLP (negation) | 0.75 | Linguistic parsing |
| NLP (vague intent) | 0.40 | Often wrong |

Low-confidence hints may be treated as suggestions rather than filters.

### 5.6 Trade-offs

| Upside | Downside |
|--------|----------|
| Deterministic regex/alias phases | Compromise NLP adds ~20KB to worker |
| Rich metadata for debugging | Three phases add complexity |
| Graceful degradation (NLP optional) | Must maintain pattern lists |

---

## 6. Alias Registry

### 6.1 Purpose

Map known phrases to canonical entities deterministically. No NLP guessing.

### 6.2 Alias Types

```typescript
type AliasKind =
  | 'subject'      // "computer science" → CS
  | 'gened'        // "humanities" → HUM (with cue)
  | 'delivery'     // "in person" → online=false
  | 'status'       // "has seats" → status=open
  | 'difficulty'   // "gpa booster" → difficulty=easy
  | 'days'         // "tuesday thursday" → TR
  | 'time';        // "before noon" → morning

interface AliasEntry {
  kind: AliasKind;
  canonical: string;           // Target value
  aliases: string[];           // Normalized phrases
  requiresCue?: string[];      // Cue words that must be present
}
```

### 6.3 Source of Aliases

**From Database (authoritative):**
- Subjects: code + official name → generate aliases
- GenEds: code + category name → generate aliases
- Instructors: names (loaded at startup for NLP vocabulary)

**From Code (curated):**
- Common abbreviations: "comp sci", "psych", "econ"
- Schedule phrases: "tuesday thursday", "M/W/F"
- Status phrases: "has seats", "not full", "no waitlist"
- Difficulty phrases: "gpa booster", "easy A"

**Optional DB Overrides:**
For hotfixes without deploy, an `entity_aliases` table can override code defaults.

### 6.4 Matching Algorithm

1. Normalize input: lowercase, collapse whitespace, strip punctuation
2. Longest-match first: "computer science" before "computer"
3. Check cue requirements: "humanities" only maps to HUM if cue present
4. Return match with span and confidence

```typescript
function matchAliases(text: string, context: { hasCue: Record<string, boolean> }): AliasMatch[] {
  const normalized = normalize(text);
  const matches: AliasMatch[] = [];

  // Sort by phrase length descending (longest first)
  const sortedEntries = [...aliasRegistry].sort(
    (a, b) => b.longestAlias.length - a.longestAlias.length
  );

  for (const entry of sortedEntries) {
    for (const alias of entry.aliases) {
      const index = normalized.indexOf(alias);
      if (index === -1) continue;

      // Check cue requirement
      if (entry.requiresCue && !entry.requiresCue.some(cue => context.hasCue[cue])) {
        continue;
      }

      matches.push({
        kind: entry.kind,
        canonical: entry.canonical,
        span: [index, index + alias.length],
        confidence: 0.9,
      });

      // Remove matched span to avoid double-matching
      normalized = removeSpan(normalized, [index, index + alias.length]);
    }
  }

  return matches;
}
```

### 6.5 The Cue Rule (Critical)

GenEd name aliases require a cue word to activate:

| Query | Cue present? | Result |
|-------|--------------|--------|
| `humanities` | No | Semantic search + suggestion |
| `humanities gen ed` | Yes ("gen ed") | Filter: gened_code=HUM |
| `humanities requirement` | Yes ("requirement") | Filter: gened_code=HUM |
| `HUM` | N/A (code, not name) | Filter: gened_code=HUM |

**Cue words:** "gen ed", "gened", "requirement", "category", "gen-ed"

**Rationale:** Without this rule, "humanities" would always filter to HUM gened, but users often mean the topic broadly. The cue indicates filter intent.

### 6.6 Trade-offs

| Upside | Downside |
|--------|----------|
| Deterministic, testable | Must maintain alias lists |
| Fast (no NLP) | Can't handle typos (yet) |
| Explainable (can show "matched X as Y") | Cue rule adds complexity |

**Future enhancement:** Add small fuzzy layer for typos ("compter science" → "computer science").

---

## 7. Disambiguator

### 7.1 Purpose

Apply context-aware rules to resolve ambiguous hints and generate suggestions.

### 7.2 Disambiguation Rules

**Rule 1: CS Ambiguity**
- "CS" alone → Subject (Computer Science)
- "CS" near "gen ed"/"requirement" → GenEd (Cultural Studies)
- "CS 225" → Course code (unambiguous)

**Rule 2: Subject vs Topic**
- Subject name followed by number → Course code, not subject filter
- Subject name alone → Subject filter + suggestion to search broadly

**Rule 3: GenEd Cue Rule**
- GenEd name with cue → Filter
- GenEd name without cue → Semantic + suggestion

**Rule 4: Level Keywords**
- "intro" / "introductory" → level=100
- "advanced" / "upper level" → level=400
- "graduate" / "grad" → level=500

### 7.3 Suggestion Generation

When a term is ambiguous, attach a suggestion:

```typescript
interface Suggestion {
  text: string;                  // Display text
  action: 'add_filter' | 'remove_filter' | 'change_filter';
  filter?: Partial<SearchFilters>;
}

// Example: "humanities" without cue
{
  text: "Filter by GenEd: Humanities & Arts?",
  action: "add_filter",
  filter: { gened_code: "HUM" }
}
```

The UI can render these as clickable chips that refine the search.

### 7.4 Output

```typescript
interface DisambiguationResult {
  hints: Hint[];                 // Resolved hints
  suggestions: Suggestion[];     // UI suggestions
  warnings: string[];            // Potential issues
}
```

---

## 8. Resolver

### 8.1 Purpose

Validate hints against the database and build the final SearchPlan.

### 8.2 Responsibilities

| Hint Type | Resolution |
|-----------|------------|
| `subject` | Validate exists in subjects table |
| `courseCode` | Split into subject + number, validate subject |
| `instructor` | Fuzzy match against instructors table, get ID |
| `gened` | Map synonym to canonical code if needed |
| `crn` | Validate format (5 digits) |
| Others | Pass through unchanged |

### 8.3 Instructor Resolution

Instructors require fuzzy matching because users type partial names:

```typescript
async function resolveInstructor(
  db: D1Database,
  name: string
): Promise<{ id: number; displayName: string } | null> {
  // Try exact match first
  const exact = await db.prepare(
    `SELECT id, display_name FROM instructors
     WHERE LOWER(display_name) = LOWER(?)`
  ).bind(name).first();

  if (exact) return exact;

  // Try last name match
  const lastName = await db.prepare(
    `SELECT id, display_name FROM instructors
     WHERE LOWER(display_name) LIKE ?`
  ).bind(`%${name.toLowerCase()}%`).all();

  if (lastName.results.length === 1) {
    return lastName.results[0];
  }

  if (lastName.results.length > 1) {
    // Ambiguous - return null and let caller handle
    return null;
  }

  return null;
}
```

### 8.4 SearchPlan Output

```typescript
interface SearchPlan {
  filters: SearchFilters;
  semanticQuery: string;         // For embedding search
  keywordQuery: string;          // For FTS
  ambiguities?: Ambiguity[];     // Unresolved ambiguities
}

interface SearchFilters {
  // Entity filters
  instructor_ids?: number[];
  subject?: string;
  number?: string;
  crn?: string;
  gened_code?: string;
  gened_any?: string[];
  gened_all?: string[];

  // Schedule filters
  days?: string;
  time?: string;

  // Attribute filters
  level?: number;
  credits?: number;
  online?: boolean;
  status?: string;
  difficulty?: string;

  // Negations
  not?: {
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
  };
}
```

---

## 9. Search Execution

### 9.1 Overview

Search runs two parallel paths, then merges with Reciprocal Rank Fusion (RRF):

```
SearchPlan
    │
    ├──▶ Keyword Search (FTS5)
    │         │
    │         ▼
    │    RankedResults[]
    │         │
    └──▶ Semantic Search (Vectorize)
              │
              ▼
         RankedResults[]
              │
              ▼
         RRF Merge
              │
              ▼
         Apply Filters
              │
              ▼
         Final Results
```

### 9.2 Filter Application

Filters are applied as SQL WHERE clauses in keyword search and as post-filters in semantic search.

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

const DIFFICULTY_THRESHOLDS = {
  easy: { min_gpa: 3.5, max_difficulty: 3.0 },
  hard: { max_gpa: 3.0, min_difficulty: 4.0 },
};

const STATUS_VALUES: Record<string, string[]> = {
  'open': ['Open'],
  'available': ['Open', 'Restricted'],
};
```

**Filter SQL Generation:**

```typescript
function buildFilterClauses(
  filters: SearchFilters
): { joins: string[]; where: string[]; params: any[] } {
  const joins: string[] = [];
  const where: string[] = [];
  const params: any[] = [];

  // Subject filter
  if (filters.subject) {
    where.push('c.subject = ?');
    params.push(filters.subject);
  }

  // Course number filter
  if (filters.number) {
    where.push('c.number = ?');
    params.push(filters.number);
  }

  // Instructor filter
  if (filters.instructor_ids?.length) {
    joins.push('JOIN section_instructors si ON si.section_crn = s.crn');
    where.push(`si.instructor_id IN (${filters.instructor_ids.map(() => '?').join(',')})`);
    params.push(...filters.instructor_ids);
  }

  // GenEd filter (single)
  if (filters.gened_code) {
    joins.push('JOIN course_geneds cg ON cg.course_id = c.id');
    where.push('cg.category_id = ?');
    params.push(filters.gened_code);
  }

  // GenEd filter (any)
  if (filters.gened_any?.length) {
    joins.push('JOIN course_geneds cg ON cg.course_id = c.id');
    where.push(`cg.category_id IN (${filters.gened_any.map(() => '?').join(',')})`);
    params.push(...filters.gened_any);
  }

  // GenEd filter (all) - requires HAVING
  // Handled separately in query construction

  // Days filter
  if (filters.days) {
    joins.push('JOIN sections s ON s.course_id = c.id');
    joins.push('JOIN meetings m ON m.section_crn = s.crn');
    where.push('m.days = ?');
    params.push(filters.days);
  }

  // Time filter
  if (filters.time) {
    const range = TIME_RANGES[filters.time];
    joins.push('JOIN sections s ON s.course_id = c.id');
    joins.push('JOIN meetings m ON m.section_crn = s.crn');
    if (range.start) {
      where.push('m.start_time >= ?');
      params.push(range.start);
    }
    if (range.end) {
      where.push('m.start_time < ?');
      params.push(range.end);
    }
  }

  // Level filter
  if (filters.level) {
    const levelNum = LEVEL_MAP[filters.level] ?? filters.level;
    where.push('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 = ?');
    params.push(levelNum);
  }

  // Credits filter
  if (filters.credits) {
    where.push('c.credit_hours = ?');
    params.push(filters.credits);
  }

  // Online filter
  if (filters.online !== undefined) {
    joins.push('JOIN sections s ON s.course_id = c.id');
    joins.push('JOIN meetings m ON m.section_crn = s.crn');
    if (filters.online) {
      where.push("(m.building_name = '' OR m.building_name IS NULL OR LOWER(m.building_name) LIKE '%online%')");
    } else {
      where.push("m.building_name != '' AND m.building_name IS NOT NULL AND LOWER(m.building_name) NOT LIKE '%online%'");
    }
  }

  // Status filter
  if (filters.status) {
    joins.push('JOIN sections s ON s.course_id = c.id');
    const statuses = STATUS_VALUES[filters.status] ?? ['Open'];
    where.push(`s.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }

  // Difficulty filter
  if (filters.difficulty) {
    const thresholds = DIFFICULTY_THRESHOLDS[filters.difficulty];
    if (thresholds.min_gpa) {
      where.push('c.avg_gpa >= ?');
      params.push(thresholds.min_gpa);
    }
    if (thresholds.max_gpa) {
      where.push('c.avg_gpa <= ?');
      params.push(thresholds.max_gpa);
    }
    if (thresholds.min_difficulty) {
      where.push('c.difficulty_score >= ?');
      params.push(thresholds.min_difficulty);
    }
    if (thresholds.max_difficulty) {
      where.push('c.difficulty_score <= ?');
      params.push(thresholds.max_difficulty);
    }
  }

  // Deduplicate joins
  const uniqueJoins = [...new Set(joins)];

  return { joins: uniqueJoins, where, params };
}
```

### 9.3 GenEd All Filter

The `gened:all(NW,US)` filter requires a course to have ALL specified geneds. This needs a GROUP BY + HAVING:

```sql
SELECT c.id, c.subject, c.number, c.title
FROM courses c
JOIN course_geneds cg ON cg.course_id = c.id
WHERE cg.category_id IN ('NW', 'US')
GROUP BY c.id
HAVING COUNT(DISTINCT cg.category_id) = 2
```

### 9.4 Matching Sections Metadata

When section-level filters are applied (days, time, online, status), we track which sections matched:

```typescript
interface SearchResult {
  course: Course;
  score: number;
  // ... other fields

  // Section match metadata
  matchingSections?: number;
  matchingCrns?: string[];
}
```

This allows the UI to highlight or filter sections when displaying course details.

### 9.5 Trade-offs

| Upside | Downside |
|--------|----------|
| Section-level filtering | Requires JOINs (slower) |
| Matching section metadata | Extra query for CRN collection |
| All filters composable | Complex SQL generation |

**Mitigation:** Only add section JOINs when section filters are present.

---

## 10. Response Shape

### 10.1 API Response

```typescript
interface SearchResponse {
  results: CourseResult[];
  meta: {
    query: {
      raw: string;               // Original query
      residual: string;          // What went to semantic search
    };
    extraction: {
      hints: Hint[];             // All extracted hints
      source: 'regex' | 'alias' | 'nlp';
    };
    plan: {
      filters: SearchFilters;    // Applied filters
      clauses?: ParsedClause[];  // If OR was used
    };
    suggestions?: Suggestion[];  // Disambiguation suggestions
    timing?: {
      extraction_ms: number;
      search_ms: number;
      total_ms: number;
    };
  };
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

interface CourseResult {
  // Course data
  id: string;
  subject: string;
  number: string;
  title: string;
  description?: string;
  creditHours: string;

  // Search metadata (prefixed with _)
  _score: number;
  _semanticRank?: number;
  _keywordRank?: number;
  _termPriority?: number;
  _matchingSections?: number;
  _matchingCrns?: string[];
}
```

### 10.2 Example Response

Query: `easy cs gen ed with fagen no mornings`

```json
{
  "results": [
    {
      "id": "CS-100-2025-spring",
      "subject": "CS",
      "number": "100",
      "title": "Freshman Orientation",
      "creditHours": "1",
      "_score": 0.87,
      "_matchingSections": 2,
      "_matchingCrns": ["12345", "12346"]
    }
  ],
  "meta": {
    "query": {
      "raw": "easy cs gen ed with fagen no mornings",
      "residual": ""
    },
    "extraction": {
      "hints": [
        { "type": "difficulty", "value": "easy", "metadata": { "source": "alias", "confidence": 0.9 } },
        { "type": "gened", "value": "CS", "metadata": { "source": "alias", "confidence": 0.9 } },
        { "type": "instructor", "value": "Fagen", "metadata": { "source": "nlp", "confidence": 0.8 } },
        { "type": "negation", "value": { "target": "time", "value": "morning" }, "metadata": { "source": "nlp", "confidence": 0.75 } }
      ]
    },
    "plan": {
      "filters": {
        "difficulty": "easy",
        "gened_code": "CS",
        "instructor_ids": [42],
        "not": { "time": ["morning", "early"] }
      }
    },
    "timing": {
      "extraction_ms": 12,
      "search_ms": 85,
      "total_ms": 97
    }
  },
  "pagination": {
    "total": 15,
    "limit": 20,
    "offset": 0
  }
}
```

### 10.3 UI Consumption

The frontend uses meta to render:
1. **Chips** showing applied filters (from `plan.filters`)
2. **Suggestion chips** for disambiguation (from `suggestions`)
3. **Section highlighting** for matched sections (from `_matchingCrns`)

---

## 11. Testing Strategy

### 11.1 Unit Tests

**Query Parser:**
```typescript
describe('parseQuery', () => {
  it('splits top-level OR', () => { ... });
  it('extracts field:value filters', () => { ... });
  it('extracts gened:any(...)', () => { ... });
  it('extracts -negations', () => { ... });
  it('extracts "phrases"', () => { ... });
});
```

**Extractor:**
```typescript
describe('extract', () => {
  describe('phase 1: regex', () => {
    it('extracts course codes', () => { ... });
    it('extracts CRNs', () => { ... });
    it('extracts credit hours', () => { ... });
  });

  describe('phase 2: aliases', () => {
    it('matches subject names', () => { ... });
    it('applies gened cue rule', () => { ... });
  });

  describe('phase 3: nlp', () => {
    it('extracts instructor names', () => { ... });
    it('extracts negation phrases', () => { ... });
  });
});
```

**Alias Registry:**
```typescript
describe('aliasRegistry', () => {
  it('matches longest phrase first', () => { ... });
  it('requires cue for gened names', () => { ... });
  it('loads subject aliases from DB', () => { ... });
});
```

**Resolver:**
```typescript
describe('resolveQuery', () => {
  it('validates subject exists', () => { ... });
  it('resolves instructor name to ID', () => { ... });
  it('handles ambiguous instructors', () => { ... });
});
```

**Search Filters:**
```typescript
describe('buildFilterClauses', () => {
  it('generates correct SQL for days filter', () => { ... });
  it('generates correct SQL for time ranges', () => { ... });
  it('generates correct SQL for gened_all', () => { ... });
  it('deduplicates JOINs', () => { ... });
});
```

### 11.2 Golden File Tests

A single JSON file with expected parses for common queries:

```json
[
  {
    "input": "cs 225",
    "expected": {
      "hints": [{ "type": "courseCode", "value": { "subject": "CS", "number": "225" } }],
      "filters": { "subject": "CS", "number": "225" },
      "residual": ""
    }
  },
  {
    "input": "easy humanities gen ed",
    "expected": {
      "hints": [
        { "type": "difficulty", "value": "easy" },
        { "type": "gened", "value": "HUM" }
      ],
      "filters": { "difficulty": "easy", "gened_code": "HUM" },
      "residual": ""
    }
  },
  {
    "input": "humanities",
    "expected": {
      "hints": [],
      "filters": {},
      "residual": "humanities",
      "suggestions": [{ "text": "Filter by GenEd: Humanities & Arts?" }]
    }
  }
]
```

### 11.3 Integration Tests

Test the full pipeline against real D1:

```typescript
describe('search integration', () => {
  it('returns courses matching MWF morning filter', async () => { ... });
  it('returns courses with gened_all(NW,US)', async () => { ... });
  it('excludes courses with negated instructor', async () => { ... });
});
```

---

## 12. Migration Plan

### 12.1 What Gets Deleted

- `packages/query-extractor-lite/` — Replaced by server extractor
- `apps/web/src/lib/extractor.ts` — No client extraction needed

### 12.2 What Gets Created

| File | Purpose |
|------|---------|
| `apps/api/src/services/query-parser.ts` | Power-user syntax parser |
| `apps/api/src/services/extractor.ts` | Natural language extraction |
| `apps/api/src/services/alias-registry.ts` | Deterministic alias matching |
| `apps/api/src/services/disambiguator.ts` | Context rules + suggestions |

### 12.3 What Gets Modified

| File | Changes |
|------|---------|
| `packages/query-types/index.ts` | Add new filter types |
| `apps/api/src/services/query-resolver.ts` | Handle all hint types |
| `apps/api/src/services/search.ts` | Apply all filters |
| `apps/api/src/routes/search.ts` | Return full response metadata |

### 12.4 Migration Steps

1. **Create new services** (query-parser, extractor, alias-registry, disambiguator)
2. **Add filter types** to query-types package
3. **Update resolver** to use new extraction pipeline
4. **Update search** to apply new filters
5. **Update route** to return metadata
6. **Update frontend** to display chips from response
7. **Delete old code** (query-extractor-lite, client extractor)
8. **Run full test suite**

---

## 13. Open Questions

### 13.1 Deferred Decisions

| Question | Current Answer | Revisit When |
|----------|----------------|--------------|
| Add fuzzy matching for typos? | No | Query logs show typo frequency |
| Add client-side preview chips? | No | Users request instant feedback |
| Add nested boolean (AND/OR)? | No | Power users request it |
| Add saved searches / filters? | No | After basic search works |

### 13.2 Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| avg_gpa column | Needs data | Difficulty filter empty until populated |
| difficulty_score column | Needs data | Difficulty filter empty until populated |
| Compromise NLP | ~20KB in worker | Consider lazy load |
| Instructor names in DB | Required | For NLP vocabulary |

---

## 14. Summary

This design consolidates three previous plans into a unified system:

| Previous Plan | What We Keep | What We Drop |
|---------------|--------------|--------------|
| P1 Filters | All filter types and SQL logic | Nothing |
| Query Language v1 | gened:any/all, field:value, -negation | `search-string` library, top-level OR (keep simple) |
| Isomorphic Extractor | Compromise NLP for instructors | Client extraction, isomorphic code |

**The result is a server-only, layman-first query system** that:
- Extracts structure from natural language
- Applies filters only when obvious
- Suggests alternatives for ambiguous terms
- Returns rich metadata for UI rendering
- Runs entirely on the server with zero client-side processing

This is simpler, more maintainable, and delivers the same UX as the more complex alternatives.
