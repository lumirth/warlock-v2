# Smart Query Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix course code recognition ("CS 225" returns CS 225) and add smart natural language query extraction.

**Architecture:** Multi-stage extraction pipeline: regex patterns extract structured data (course codes, CRNs), compromise.js extracts semantic terms (easy, morning), server resolves against database (subjects, instructors). Two FTS indexes (courses + sections) merged via RRF.

**Tech Stack:** TypeScript, Hono, D1/SQLite, FTS5, compromise.js, Vitest

---

## Phase 1: Course Code Recognition (P0 - Critical Fix)

### Task 1.1: Add Course Code Pattern to Query Types

**Files:**
- Modify: `packages/query-types/index.ts`

**Step 1: Update QueryHintType to include 'course_code'**

Edit `packages/query-types/index.ts`:

```typescript
export type QueryHintType = 'instructor' | 'gened' | 'subject' | 'credits' | 'term' | 'level' | 'course_code' | 'crn' | 'days' | 'time' | 'difficulty' | 'online' | 'status';

export interface QueryHint {
  type: QueryHintType;
  value: string;
  confidence: number;
  isExplicit?: boolean;
  metadata?: Record<string, string>; // For course_code: { subject: 'CS', number: '225' }
}

export interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];
  residual: string;
}

export interface SearchFilters {
  instructor_ids?: number[];
  gened_code?: string;
  subject?: string;
  number?: string;           // NEW: course number
  level?: number;
  credits?: number;
  term?: string;
  year?: number;             // NEW
  days?: string;             // NEW: "MWF", "TR"
  time_start?: string;       // NEW: "09:00"
  time_end?: string;         // NEW
  difficulty?: 'easy' | 'hard'; // NEW
  online?: boolean;          // NEW
  status?: 'open' | 'closed'; // NEW
}

export interface Ambiguity {
  term: string;
  chosen: { type: string; value: string; label: string };
  alternatives: { type: string; value: string; label: string }[];
}

export interface SearchPlan {
  filters: SearchFilters;
  semanticQuery: string;
  keywordQuery: string;
  ambiguities?: Ambiguity[];  // NEW: for disambiguation hints
}
```

**Step 2: Commit**

```bash
git add packages/query-types/index.ts
git commit -m "feat(types): expand QueryHintType and SearchFilters for smart extraction"
```

---

### Task 1.2: Add Course Code Extraction Pattern

**Files:**
- Modify: `packages/query-extractor-lite/index.ts`
- Modify: `packages/query-extractor-lite/index.test.ts`

**Step 1: Write failing tests for course code extraction**

Edit `packages/query-extractor-lite/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractQueryLite } from './index';

describe('extractQueryLite', () => {
  describe('course code extraction', () => {
    it('extracts "CS 225" as course_code', () => {
      const result = extractQueryLite('CS 225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          value: 'CS 225',
          metadata: { subject: 'CS', number: '225' }
        })
      );
      expect(result.residual.trim()).toBe('');
    });

    it('extracts "cs225" (no space, lowercase)', () => {
      const result = extractQueryLite('cs225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
    });

    it('extracts "CS225" (no space)', () => {
      const result = extractQueryLite('CS225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
    });

    it('extracts course code with surrounding text', () => {
      const result = extractQueryLite('easy CS 225 morning');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
      expect(result.residual).toContain('easy');
      expect(result.residual).toContain('morning');
    });

    it('extracts 4-letter subject codes', () => {
      const result = extractQueryLite('MATH 241');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'MATH', number: '241' }
        })
      );
    });

    it('extracts 2-letter subject codes', () => {
      const result = extractQueryLite('UP 101');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'UP', number: '101' }
        })
      );
    });
  });

  describe('CRN extraction', () => {
    it('extracts 5-digit CRN', () => {
      const result = extractQueryLite('12345');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '12345'
        })
      );
    });

    it('extracts CRN with prefix', () => {
      const result = extractQueryLite('CRN 67890');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '67890'
        })
      );
    });
  });

  describe('existing instructor extraction', () => {
    it('extracts instructor with "with" keyword', () => {
      const result = extractQueryLite('CS 225 with fagen');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'instructor', value: 'fagen' })
      );
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'course_code' })
      );
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/query-extractor-lite && npm test
```

Expected: FAIL - course_code pattern not implemented

**Step 3: Implement course code extraction**

Edit `packages/query-extractor-lite/index.ts`:

```typescript
import type { ExtractedQuery, QueryHint } from '@uiuc-course-search/query-types';

export function extractQueryLite(query: string): ExtractedQuery {
  const hints: QueryHint[] = [];
  let residual = query;

  // 1. Course code pattern: "CS 225", "cs225", "MATH241"
  // Matches 2-4 letter subject + optional space + 3-digit number
  const courseCodeRegex = /\b([A-Za-z]{2,4})\s*(\d{3})\b/g;
  let courseMatch;
  while ((courseMatch = courseCodeRegex.exec(residual)) !== null) {
    hints.push({
      type: 'course_code',
      value: `${courseMatch[1].toUpperCase()} ${courseMatch[2]}`,
      confidence: 0.95,
      metadata: {
        subject: courseMatch[1].toUpperCase(),
        number: courseMatch[2]
      }
    });
  }
  // Remove matched course codes from residual
  residual = residual.replace(courseCodeRegex, ' ');

  // 2. CRN pattern: standalone 5-digit number or "CRN 12345"
  const crnWithPrefixRegex = /\bCRN\s*(\d{5})\b/gi;
  let crnPrefixMatch;
  while ((crnPrefixMatch = crnWithPrefixRegex.exec(residual)) !== null) {
    hints.push({
      type: 'crn',
      value: crnPrefixMatch[1],
      confidence: 0.95
    });
  }
  residual = residual.replace(crnWithPrefixRegex, ' ');

  // Standalone 5-digit number (only if no other context suggests it's something else)
  const standaloneCrnRegex = /\b(\d{5})\b/g;
  let standaloneCrnMatch;
  while ((standaloneCrnMatch = standaloneCrnRegex.exec(residual)) !== null) {
    // Only treat as CRN if it's the primary content or clearly a CRN
    hints.push({
      type: 'crn',
      value: standaloneCrnMatch[1],
      confidence: 0.7  // Lower confidence for standalone numbers
    });
  }
  residual = residual.replace(standaloneCrnRegex, ' ');

  // 3. Instructor pattern: "by [Name]", "with [Name]", "prof [Name]", "professor [Name]"
  const instructorRegex = /\b(by|with|prof|professor)\s+([a-zA-Z][\w-]*)/gi;
  let instructorMatch;
  while ((instructorMatch = instructorRegex.exec(residual)) !== null) {
    hints.push({
      type: 'instructor',
      value: instructorMatch[2].toLowerCase(),
      confidence: 0.8
    });
  }
  residual = residual.replace(instructorRegex, ' ');

  // 4. GenEd pattern: "gened [Category]" or "[Category] gened"
  const genedForwardRegex = /\b(gened|gen ed|gen-ed)\s+([a-zA-Z]+)/gi;
  let genedMatch;
  while ((genedMatch = genedForwardRegex.exec(residual)) !== null) {
    hints.push({
      type: 'gened',
      value: genedMatch[2].toLowerCase(),
      confidence: 0.7
    });
  }
  residual = residual.replace(genedForwardRegex, ' ');

  const genedBackwardRegex = /\b([a-zA-Z]+)\s+(gened|gen ed|gen-ed)\b/gi;
  while ((genedMatch = genedBackwardRegex.exec(residual)) !== null) {
    hints.push({
      type: 'gened',
      value: genedMatch[1].toLowerCase(),
      confidence: 0.6
    });
  }
  residual = residual.replace(genedBackwardRegex, ' ');

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  return {
    rawQuery: query,
    hints,
    residual
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/query-extractor-lite && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/query-extractor-lite/
git commit -m "feat(extractor): add course code and CRN extraction patterns"
```

---

### Task 1.3: Handle Course Code in Query Resolver

**Files:**
- Modify: `apps/api/src/services/query-resolver.ts`
- Create: `apps/api/src/services/__tests__/query-resolver.test.ts` (expand existing)

**Step 1: Write failing test for course code resolution**

Edit `apps/api/src/services/__tests__/query-resolver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveQuery } from '../query-resolver';
import type { ExtractedQuery } from '@uiuc-course-search/query-types';

// Mock D1Database
const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  all: vi.fn(),
  first: vi.fn(),
};

describe('resolveQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('course_code hints', () => {
    it('sets subject and number filters from course_code hint', async () => {
      const extracted: ExtractedQuery = {
        rawQuery: 'CS 225',
        hints: [{
          type: 'course_code',
          value: 'CS 225',
          confidence: 0.95,
          metadata: { subject: 'CS', number: '225' }
        }],
        residual: ''
      };

      // Mock subject exists
      mockDb.first.mockResolvedValueOnce({ id: 'CS', name: 'Computer Science' });

      const plan = await resolveQuery(mockDb as any, extracted);

      expect(plan.filters.subject).toBe('CS');
      expect(plan.filters.number).toBe('225');
    });

    it('validates subject exists in database', async () => {
      const extracted: ExtractedQuery = {
        rawQuery: 'XYZ 999',
        hints: [{
          type: 'course_code',
          value: 'XYZ 999',
          confidence: 0.95,
          metadata: { subject: 'XYZ', number: '999' }
        }],
        residual: ''
      };

      // Mock subject does NOT exist
      mockDb.first.mockResolvedValueOnce(null);

      const plan = await resolveQuery(mockDb as any, extracted);

      // Should NOT set filters if subject invalid
      expect(plan.filters.subject).toBeUndefined();
      expect(plan.filters.number).toBeUndefined();
      // Query should fall back to semantic search
      expect(plan.semanticQuery).toBe('XYZ 999');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npm test -- --grep "course_code"
```

Expected: FAIL

**Step 3: Implement course code resolution**

Edit `apps/api/src/services/query-resolver.ts`:

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import type { ExtractedQuery, SearchPlan, QueryHint, Ambiguity } from '@uiuc-course-search/query-types';

const GENED_SYNONYMS: Record<string, string[]> = {
  // Composition
  'CMP': ['comp 1', 'composition', 'writing', 'rhet 105', 'freshman comp', 'comp1'],
  'ACP': ['adv comp', 'advanced composition', 'advanced comp', 'writing intensive', 'cll'],

  // Humanities & Arts
  'HUM': ['humanities', 'humanities and the arts', 'arts'],
  'HP': ['historical', 'philosophical', 'history', 'philosophy', 'historical perspectives'],
  'LA': ['literature', 'lit', 'literature and the arts'],

  // Natural Sciences
  'NAT': ['nat sci', 'natural sciences', 'science', 'natural sciences and technology'],
  'PS': ['physical sciences', 'physical'],
  'LS': ['life sciences', 'life sci', 'bio', 'biology'],

  // Social & Behavioral Sciences
  'SBS': ['social science', 'behavioral science', 'social and behavioral'],
  'SS': ['social', 'soc sci'],
  'BSC': ['behavioral', 'psych', 'psychology'],

  // Cultural Studies
  'CS': ['cultural studies', 'cultural'],
  'NW': ['non-western', 'non western', 'nonwestern'],
  'US': ['us minority', 'minority cultures', 'us minority cultures'],
  'WCC': ['western', 'comparative', 'western comparative'],

  // Quantitative Reasoning
  'QR': ['quantitative', 'quant', 'quantitative reasoning'],
  'QR1': ['qr1', 'qr 1', 'quant 1', 'quantitative reasoning 1', 'qri'],
  'QR2': ['qr2', 'qr 2', 'quant 2', 'quantitative reasoning 2', 'qrii'],
};

// Build reverse lookup
const GENED_LOOKUP: Record<string, string> = {};
for (const [code, synonyms] of Object.entries(GENED_SYNONYMS)) {
  GENED_LOOKUP[code.toLowerCase()] = code;
  for (const syn of synonyms) {
    GENED_LOOKUP[syn.toLowerCase()] = code;
  }
}

// Subject codes that conflict with GenEd codes
const SUBJECT_GENED_CONFLICTS = new Set(['CS', 'PS']);

export async function resolveQuery(db: D1Database, extracted: ExtractedQuery): Promise<SearchPlan> {
  const plan: SearchPlan = {
    filters: {},
    semanticQuery: extracted.residual,
    keywordQuery: extracted.residual,
    ambiguities: []
  };

  for (const hint of extracted.hints) {
    switch (hint.type) {
      case 'course_code':
        await resolveCourseCode(db, hint, plan, extracted.rawQuery);
        break;

      case 'instructor':
        const instructorIds = await resolveInstructor(db, hint.value);
        if (instructorIds.length > 0) {
          plan.filters.instructor_ids = instructorIds;
        }
        break;

      case 'gened':
        resolveGened(hint.value, plan);
        break;

      case 'subject':
        const validSubject = await validateSubject(db, hint.value);
        if (validSubject) {
          plan.filters.subject = validSubject;
        }
        break;

      case 'crn':
        // CRN is a direct lookup - handled specially in search
        plan.filters.crn = hint.value;
        break;
    }
  }

  // Clean up empty ambiguities array
  if (plan.ambiguities?.length === 0) {
    delete plan.ambiguities;
  }

  return plan;
}

async function resolveCourseCode(
  db: D1Database,
  hint: QueryHint,
  plan: SearchPlan,
  rawQuery: string
): Promise<void> {
  const subject = hint.metadata?.subject;
  const number = hint.metadata?.number;

  if (!subject || !number) return;

  // Validate subject exists
  const validSubject = await validateSubject(db, subject);

  if (validSubject) {
    plan.filters.subject = validSubject;
    plan.filters.number = number;

    // Check for subject/gened conflict
    if (SUBJECT_GENED_CONFLICTS.has(validSubject)) {
      // Check context for disambiguation
      const genedKeywords = /gened|gen ed|requirement|fulfill/i;
      if (!genedKeywords.test(rawQuery)) {
        // Subject wins, but note the ambiguity
        const genedCode = GENED_LOOKUP[validSubject.toLowerCase()];
        if (genedCode) {
          plan.ambiguities = plan.ambiguities || [];
          plan.ambiguities.push({
            term: validSubject,
            chosen: { type: 'subject', value: validSubject, label: await getSubjectName(db, validSubject) },
            alternatives: [{ type: 'gened', value: genedCode, label: getGenedLabel(genedCode) }]
          });
        }
      }
    }

    // Clear residual since we've fully resolved this
    plan.semanticQuery = plan.semanticQuery.replace(hint.value, '').trim();
    plan.keywordQuery = plan.keywordQuery.replace(hint.value, '').trim();
  } else {
    // Subject not found - keep in semantic query for fuzzy matching
    plan.semanticQuery = hint.value + ' ' + plan.semanticQuery;
  }
}

async function validateSubject(db: D1Database, subject: string): Promise<string | null> {
  const upperSubject = subject.toUpperCase();

  // Check exact code match
  const result = await db.prepare('SELECT id FROM subjects WHERE id = ?')
    .bind(upperSubject)
    .first<{ id: string }>();

  if (result) return result.id;

  // Check by name (case-insensitive)
  const byName = await db.prepare('SELECT id FROM subjects WHERE LOWER(name) = LOWER(?)')
    .bind(subject)
    .first<{ id: string }>();

  if (byName) return byName.id;

  // TODO: Add alias lookup and fuzzy matching in Phase 5

  return null;
}

async function getSubjectName(db: D1Database, code: string): Promise<string> {
  const result = await db.prepare('SELECT name FROM subjects WHERE id = ?')
    .bind(code)
    .first<{ name: string }>();
  return result?.name || code;
}

function getGenedLabel(code: string): string {
  const labels: Record<string, string> = {
    'CS': 'Cultural Studies',
    'PS': 'Physical Sciences',
    'HUM': 'Humanities & Arts',
    'NAT': 'Natural Sciences',
    'SBS': 'Social & Behavioral Sciences',
    'QR': 'Quantitative Reasoning',
  };
  return labels[code] || code;
}

function resolveGened(value: string, plan: SearchPlan): void {
  const normalized = value.toLowerCase().trim();
  const code = GENED_LOOKUP[normalized];

  if (code) {
    plan.filters.gened_code = code;
  } else {
    // Keep raw value as fallback
    plan.filters.gened_code = value.toUpperCase();
  }
}

async function resolveInstructor(db: D1Database, name: string): Promise<number[]> {
  const query = `
    SELECT id FROM instructors
    WHERE last_name LIKE ? OR display_name LIKE ?
    LIMIT 10
  `;
  const { results } = await db.prepare(query)
    .bind(`%${name}%`, `%${name}%`)
    .all<{ id: number }>();

  return results.map(r => r.id);
}
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/api && npm test
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/query-resolver.ts apps/api/src/services/__tests__/
git commit -m "feat(resolver): handle course_code hints with subject validation"
```

---

### Task 1.4: Update Search to Use Course Filters

**Files:**
- Modify: `apps/api/src/services/search.ts`

**Step 1: Add number filter to keywordSearch**

Edit `apps/api/src/services/search.ts` - add to the filter handling:

```typescript
// Add after the subject filter check (around line 35)
if (filters.number) {
  whereClauses.push('c.number = ?');
  params.push(filters.number);
}

// Add CRN handling (direct lookup, bypasses FTS)
if (filters.crn) {
  // CRN is a direct section lookup
  const crnSql = `
    SELECT DISTINCT c.id, 1.0 as fts_score
    FROM sections s
    JOIN courses c ON s.course_id = c.id
    WHERE s.crn = ?
    LIMIT 1
  `;
  const crnResult = await db.prepare(crnSql).bind(filters.crn).all<{ id: string }>();
  if (crnResult.results.length > 0) {
    return crnResult.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
  }
}
```

**Step 2: Add exact match boosting**

When both subject AND number are specified, prioritize exact matches:

```typescript
export async function keywordSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  const { filters, keywordQuery } = plan;

  // Fast path: exact course lookup (subject + number)
  if (filters.subject && filters.number && !keywordQuery?.trim()) {
    const exactSql = `
      SELECT id FROM courses
      WHERE subject = ? AND number = ?
      ORDER BY year DESC,
        CASE term WHEN 'spring' THEN 1 WHEN 'fall' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END
      LIMIT ?
    `;
    const exactResult = await db.prepare(exactSql)
      .bind(filters.subject, filters.number, limit)
      .all<{ id: string }>();

    if (exactResult.results.length > 0) {
      return exactResult.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
    }
  }

  // CRN direct lookup
  if (filters.crn) {
    const crnSql = `
      SELECT DISTINCT c.id
      FROM sections s
      JOIN courses c ON s.course_id = c.id
      WHERE s.crn = ?
      LIMIT 1
    `;
    const crnResult = await db.prepare(crnSql).bind(filters.crn).all<{ id: string }>();
    if (crnResult.results.length > 0) {
      return crnResult.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
    }
  }

  // Build WHERE clause for filters
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];
  const joins: string[] = [];

  if (filters.subject) {
    whereClauses.push('c.subject = ?');
    params.push(filters.subject);
  }

  if (filters.number) {
    whereClauses.push('c.number = ?');
    params.push(filters.number);
  }

  if (filters.credits !== undefined) {
    whereClauses.push('c.credit_hours = ?');
    params.push(filters.credits);
  }

  if (filters.gened_code) {
    joins.push('JOIN course_gened cg ON cg.course_id = c.id');
    whereClauses.push('(cg.category_id = ? OR cg.attribute_code = ?)');
    params.push(filters.gened_code, filters.gened_code);
  }

  if (filters.instructor_ids && filters.instructor_ids.length > 0) {
    joins.push('JOIN sections s ON s.course_id = c.id');
    joins.push('JOIN meetings m ON m.section_crn = s.crn');
    joins.push('JOIN meeting_instructors mi ON mi.meeting_id = m.id');

    const placeholders = filters.instructor_ids.map(() => '?').join(',');
    whereClauses.push(`mi.instructor_id IN (${placeholders})`);
    params.push(...filters.instructor_ids);
  }

  const whereClause = whereClauses.length > 0
    ? 'WHERE ' + whereClauses.join(' AND ')
    : '';

  const joinClause = joins.join(' ');

  // FTS5 search with BM25 ranking
  const hasKeyword = keywordQuery && keywordQuery.trim().length > 0;

  const sql = hasKeyword ? `
    SELECT DISTINCT c.id, bm25(courses_fts) as fts_score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${joinClause}
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} courses_fts MATCH ?
    ORDER BY fts_score
    LIMIT ?
  ` : `
    SELECT DISTINCT c.id, 0 as fts_score
    FROM courses c
    ${joinClause}
    ${whereClause}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const finalParams = [...params];
  if (hasKeyword) {
    const escapedQuery = keywordQuery.replace(/['\"]/g, '').trim();
    finalParams.push(escapedQuery);
  }
  finalParams.push(limit);

  const result = await db.prepare(sql).bind(...finalParams).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}
```

**Step 3: Commit**

```bash
git add apps/api/src/services/search.ts
git commit -m "feat(search): add exact course lookup and number filter"
```

---

### Task 1.5: Integration Test - "CS 225" Returns CS 225

**Files:**
- Create: `apps/api/src/services/__tests__/search.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Search Integration', () => {
  it('"CS 225" query returns CS 225 as top result', async () => {
    // This is a smoke test that verifies the full pipeline
    // Run against actual deployed API or local dev server

    const response = await fetch('http://localhost:8787/api/search?q=CS%20225');
    const data = await response.json();

    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);

    const topResult = data.results[0];
    expect(topResult.subject).toBe('CS');
    expect(topResult.number).toBe('225');
  });
});
```

**Step 2: Manual verification**

```bash
# Start dev server
cd apps/api && npm run dev

# In another terminal, test the endpoint
curl "http://localhost:8787/api/search?q=CS%20225" | jq '.results[0] | {subject, number, title}'
```

Expected output:
```json
{
  "subject": "CS",
  "number": "225",
  "title": "Data Structures"
}
```

**Step 3: Commit**

```bash
git add apps/api/src/services/__tests__/search.test.ts
git commit -m "test(search): add integration test for CS 225 lookup"
```

---

## Phase 2: sections_fts for Topics Courses

### Task 2.1: Create sections_fts Virtual Table

**Files:**
- Modify: `apps/api/src/db/schema.sql`

**Step 1: Add sections_fts definition**

Add to `apps/api/src/db/schema.sql`:

```sql
-- Full-text search for sections (topics courses, section-level instructors)
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
    section_title,
    instructor,
    section_text,
    section_notes,
    content='sections',
    content_rowid='rowid',
    tokenize='trigram'
);

-- Triggers to keep sections_fts in sync
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

**Step 2: Deploy schema migration**

```bash
cd apps/api && npx wrangler d1 execute uiuc-course-search --remote --file=src/db/schema.sql
```

**Step 3: Backfill existing sections**

```bash
cd apps/api && npx wrangler d1 execute uiuc-course-search --remote --command="INSERT INTO sections_fts(rowid, section_title, instructor, section_text, section_notes) SELECT rowid, section_title, instructor, section_text, section_notes FROM sections;"
```

**Step 4: Commit**

```bash
git add apps/api/src/db/schema.sql
git commit -m "feat(db): add sections_fts for topics course search"
```

---

### Task 2.2: Query Both FTS Tables in Search

**Files:**
- Modify: `apps/api/src/services/search.ts`

**Step 1: Add sections_fts query function**

```typescript
export async function sectionKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  if (!keywordQuery || !keywordQuery.trim()) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
    FROM sections_fts fts
    JOIN sections s ON s.rowid = fts.rowid
    JOIN courses c ON s.course_id = c.id
    WHERE sections_fts MATCH ?
    ORDER BY fts_score
    LIMIT ?
  `;

  const escapedQuery = keywordQuery.replace(/['\"]/g, '').trim();
  const result = await db.prepare(sql).bind(escapedQuery, limit).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}
```

**Step 2: Update hybridSearch to query both FTS tables**

```typescript
export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  limit: number = 20
): Promise<SearchResult[]> {
  // Run all searches in parallel
  const [semanticResults, courseKeywordResults, sectionKeywordResults] = await Promise.all([
    semanticSearch(vectorize, ai, plan.semanticQuery, 50),
    keywordSearch(db, plan, 50),
    sectionKeywordSearch(db, plan.keywordQuery || plan.semanticQuery, 50)
  ]);

  // Build rank maps
  const semanticRanks = new Map<string, number>();
  semanticResults.forEach((r, i) => semanticRanks.set(r.id, i + 1));

  const keywordRanks = new Map<string, number>();
  courseKeywordResults.forEach((r) => keywordRanks.set(r.id, r.rank));

  // Merge section results into keyword ranks (take best rank if duplicate)
  sectionKeywordResults.forEach((r) => {
    const existing = keywordRanks.get(r.id);
    if (!existing || r.rank < existing) {
      keywordRanks.set(r.id, r.rank);
    }
  });

  // Collect all unique IDs
  const allIds = new Set([...semanticRanks.keys(), ...keywordRanks.keys()]);

  // Calculate RRF scores (rest of function unchanged)
  // ...
}
```

**Step 3: Commit**

```bash
git add apps/api/src/services/search.ts
git commit -m "feat(search): query sections_fts for topics courses"
```

---

## Phase 3: Instructor Schema Fix

### Task 3.1: Remove UNIQUE Constraint

**Files:**
- Modify: `apps/api/src/db/schema.sql`

**Step 1: Update schema**

Replace the unique index with a non-unique one:

```sql
-- Change from:
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_instructors_name ON instructors(last_name, first_name);

-- To:
DROP INDEX IF EXISTS idx_instructors_name;
CREATE INDEX IF NOT EXISTS idx_instructors_search ON instructors(last_name, first_name);
```

**Step 2: Deploy migration**

```bash
cd apps/api && npx wrangler d1 execute uiuc-course-search --remote --command="DROP INDEX IF EXISTS idx_instructors_name; CREATE INDEX IF NOT EXISTS idx_instructors_search ON instructors(last_name, first_name);"
```

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.sql
git commit -m "fix(db): allow duplicate instructor names"
```

---

### Task 3.2: Update upsertInstructor to Create Per-Section

**Files:**
- Modify: `apps/api/src/db/index.ts`

**Step 1: Update the upsert logic**

Find the `upsertInstructor` function and change from ON CONFLICT to simple INSERT:

```typescript
export async function createInstructor(
  db: D1Database,
  instructor: { firstName?: string; lastName: string; displayName: string }
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO instructors (first_name, last_name, display_name)
    VALUES (?, ?, ?)
    RETURNING id
  `)
    .bind(instructor.firstName || null, instructor.lastName, instructor.displayName)
    .first<{ id: number }>();

  return result!.id;
}

// Keep old function for backward compatibility during migration
export async function upsertInstructor(
  db: D1Database,
  instructor: { firstName?: string; lastName: string; displayName: string }
): Promise<number> {
  // For now, still use upsert behavior - will be removed in future
  // when we have proper instructor identity resolution
  const result = await db.prepare(`
    INSERT INTO instructors (first_name, last_name, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(last_name, first_name) DO UPDATE SET display_name = excluded.display_name
    RETURNING id
  `)
    .bind(instructor.firstName || null, instructor.lastName, instructor.displayName)
    .first<{ id: number }>();

  return result!.id;
}
```

**Note:** Since we removed the unique constraint, the ON CONFLICT won't trigger anymore. The upsertInstructor will just insert new rows. This is the desired behavior for now.

**Step 2: Commit**

```bash
git add apps/api/src/db/index.ts
git commit -m "feat(db): update instructor creation for non-unique names"
```

---

## Phase 4: Additional Extraction Patterns

### Task 4.1: Add Difficulty Extraction

**Files:**
- Modify: `packages/query-extractor-lite/index.ts`
- Modify: `packages/query-extractor-lite/index.test.ts`

**Step 1: Add tests**

```typescript
describe('difficulty extraction', () => {
  it('extracts "easy" keyword', () => {
    const result = extractQueryLite('easy gen ed');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'difficulty', value: 'easy' })
    );
  });

  it('extracts "hard" keyword', () => {
    const result = extractQueryLite('hard CS class');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'difficulty', value: 'hard' })
    );
  });
});
```

**Step 2: Implement**

Add to `extractQueryLite`:

```typescript
// 5. Difficulty: "easy", "hard", "difficult"
const easyRegex = /\b(easy|simple|gpa booster)\b/gi;
if (easyRegex.test(residual)) {
  hints.push({ type: 'difficulty', value: 'easy', confidence: 0.7 });
  residual = residual.replace(easyRegex, ' ');
}

const hardRegex = /\b(hard|difficult|challenging)\b/gi;
if (hardRegex.test(residual)) {
  hints.push({ type: 'difficulty', value: 'hard', confidence: 0.7 });
  residual = residual.replace(hardRegex, ' ');
}
```

**Step 3: Commit**

```bash
git add packages/query-extractor-lite/
git commit -m "feat(extractor): add difficulty extraction (easy/hard)"
```

---

### Task 4.2: Add Time and Days Extraction

**Files:**
- Modify: `packages/query-extractor-lite/index.ts`
- Modify: `packages/query-extractor-lite/index.test.ts`

**Step 1: Add tests**

```typescript
describe('time extraction', () => {
  it('extracts "morning"', () => {
    const result = extractQueryLite('morning classes');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'time', value: 'morning' })
    );
  });

  it('extracts "MWF"', () => {
    const result = extractQueryLite('MWF classes');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'days', value: 'MWF' })
    );
  });

  it('extracts "tuesday thursday"', () => {
    const result = extractQueryLite('tuesday thursday');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'days', value: 'TR' })
    );
  });
});
```

**Step 2: Implement**

```typescript
// 6. Time of day
const timeKeywords: Record<string, string> = {
  'morning': 'morning',
  'afternoon': 'afternoon',
  'evening': 'evening',
  'night': 'evening',
};
for (const [keyword, value] of Object.entries(timeKeywords)) {
  const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
  if (regex.test(residual)) {
    hints.push({ type: 'time', value, confidence: 0.7 });
    residual = residual.replace(regex, ' ');
  }
}

// 7. Days pattern
const daysPatterns: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bMWF\b/gi, value: 'MWF' },
  { pattern: /\bTR\b/gi, value: 'TR' },
  { pattern: /\bMW\b/gi, value: 'MW' },
  { pattern: /\b(tuesday|tue)\s*(thursday|thu|and\s*thursday)\b/gi, value: 'TR' },
  { pattern: /\b(monday|mon)\s*(wednesday|wed)\s*(friday|fri)\b/gi, value: 'MWF' },
];
for (const { pattern, value } of daysPatterns) {
  if (pattern.test(residual)) {
    hints.push({ type: 'days', value, confidence: 0.8 });
    residual = residual.replace(pattern, ' ');
  }
}
```

**Step 3: Commit**

```bash
git add packages/query-extractor-lite/
git commit -m "feat(extractor): add time and days extraction"
```

---

### Task 4.3: Add Online/Status Extraction

**Files:**
- Modify: `packages/query-extractor-lite/index.ts`

**Step 1: Add tests**

```typescript
describe('online extraction', () => {
  it('extracts "online"', () => {
    const result = extractQueryLite('online classes');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'online', value: 'true' })
    );
  });
});

describe('status extraction', () => {
  it('extracts "open sections"', () => {
    const result = extractQueryLite('open sections');
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'status', value: 'open' })
    );
  });
});
```

**Step 2: Implement**

```typescript
// 8. Online
const onlineRegex = /\b(online|remote|virtual)\b/gi;
if (onlineRegex.test(residual)) {
  hints.push({ type: 'online', value: 'true', confidence: 0.8 });
  residual = residual.replace(onlineRegex, ' ');
}

const inPersonRegex = /\b(in-person|in person|on campus|face to face)\b/gi;
if (inPersonRegex.test(residual)) {
  hints.push({ type: 'online', value: 'false', confidence: 0.8 });
  residual = residual.replace(inPersonRegex, ' ');
}

// 9. Section status
const openRegex = /\b(open|available)\s*(sections?|classes?)?\b/gi;
if (openRegex.test(residual)) {
  hints.push({ type: 'status', value: 'open', confidence: 0.7 });
  residual = residual.replace(openRegex, ' ');
}
```

**Step 3: Commit**

```bash
git add packages/query-extractor-lite/
git commit -m "feat(extractor): add online and status extraction"
```

---

## Phase 5: Subject Aliases and Fuzzy Matching

### Task 5.1: Create Subject Aliases Table

**Files:**
- Modify: `apps/api/src/db/schema.sql`

**Step 1: Add schema**

```sql
-- Subject aliases for natural language recognition
CREATE TABLE IF NOT EXISTS subject_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    is_auto_generated INTEGER DEFAULT 0,  -- 1 if generated from name, 0 if manual
    UNIQUE(subject_id, alias),
    FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
CREATE INDEX IF NOT EXISTS idx_subject_aliases_alias ON subject_aliases(alias);
```

**Step 2: Deploy and backfill**

```bash
cd apps/api && npx wrangler d1 execute uiuc-course-search --remote --file=src/db/schema.sql

# Backfill from subject names
cd apps/api && npx wrangler d1 execute uiuc-course-search --remote --command="INSERT OR IGNORE INTO subject_aliases (subject_id, alias, is_auto_generated) SELECT id, LOWER(name), 1 FROM subjects;"
```

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.sql
git commit -m "feat(db): add subject_aliases table"
```

---

### Task 5.2: Update Subject Resolution to Use Aliases

**Files:**
- Modify: `apps/api/src/services/query-resolver.ts`

**Step 1: Update validateSubject**

```typescript
async function validateSubject(db: D1Database, subject: string): Promise<string | null> {
  const normalized = subject.toLowerCase().trim();
  const upper = subject.toUpperCase();

  // 1. Exact code match
  const byCode = await db.prepare('SELECT id FROM subjects WHERE id = ?')
    .bind(upper)
    .first<{ id: string }>();
  if (byCode) return byCode.id;

  // 2. Full name match
  const byName = await db.prepare('SELECT id FROM subjects WHERE LOWER(name) = ?')
    .bind(normalized)
    .first<{ id: string }>();
  if (byName) return byName.id;

  // 3. Alias lookup
  const byAlias = await db.prepare('SELECT subject_id FROM subject_aliases WHERE alias = ?')
    .bind(normalized)
    .first<{ subject_id: string }>();
  if (byAlias) return byAlias.subject_id;

  // 4. Fuzzy match (simple LIKE for now)
  const fuzzy = await db.prepare(`
    SELECT id FROM subjects
    WHERE name LIKE ? OR id LIKE ?
    LIMIT 1
  `)
    .bind(`%${normalized}%`, `%${upper}%`)
    .first<{ id: string }>();
  if (fuzzy) return fuzzy.id;

  return null;
}
```

**Step 2: Commit**

```bash
git add apps/api/src/services/query-resolver.ts
git commit -m "feat(resolver): add alias and fuzzy subject matching"
```

---

## Phase 6: Term Prioritization

### Task 6.1: Add Term Ranking to Search

**Files:**
- Modify: `apps/api/src/services/search.ts`

**Step 1: Add term priority function**

```typescript
interface TermInfo {
  term_id: string;
  year: number;
  term: string;
  status: string;
}

function getTermPriority(
  termInfo: TermInfo,
  activeTerm: string | null,
  registrableTerm: string | null
): number {
  const seasonRank: Record<string, number> = { fall: 1, spring: 1, summer: 2, winter: 2 };

  // Registrable term is highest priority
  if (termInfo.term_id === registrableTerm) return 0;

  // Active term is second priority
  if (termInfo.term_id === activeTerm) return 1;

  // Historical: Fall/Spring before Winter/Summer, then by recency
  const base = 100 - termInfo.year;
  const seasonPenalty = (seasonRank[termInfo.term] === 2) ? 50 : 0;

  return 2 + base + seasonPenalty;
}
```

**Step 2: Fetch active terms and apply ranking**

```typescript
export async function hybridSearchWithTermRanking(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  limit: number = 20
): Promise<SearchResult[]> {
  // Get current term states
  const termStates = await db.prepare(`
    SELECT term_id, year, term, status FROM term_state
    WHERE status IN ('active', 'registrable')
    ORDER BY year DESC
  `).all<TermInfo>();

  const activeTerm = termStates.results.find(t => t.status === 'active')?.term_id || null;
  const registrableTerm = termStates.results.find(t => t.status === 'registrable')?.term_id || null;

  // Run standard hybrid search
  const results = await hybridSearch(db, vectorize, ai, plan, limit * 2);

  // Add term info and sort by term priority, then by score
  const enrichedResults = await Promise.all(results.map(async (r) => {
    const termInfo = {
      term_id: `${r.course.year}-${r.course.term}`,
      year: r.course.year,
      term: r.course.term,
      status: 'historical'
    };
    return {
      ...r,
      termPriority: getTermPriority(termInfo, activeTerm, registrableTerm),
      historical: termInfo.term_id !== activeTerm && termInfo.term_id !== registrableTerm
    };
  }));

  // Sort by term priority first, then by score
  enrichedResults.sort((a, b) => {
    if (a.termPriority !== b.termPriority) {
      return a.termPriority - b.termPriority;
    }
    return b.score - a.score;
  });

  return enrichedResults.slice(0, limit);
}
```

**Step 3: Commit**

```bash
git add apps/api/src/services/search.ts
git commit -m "feat(search): add term prioritization (registrable > active > historical)"
```

---

### Task 6.2: Update Search Route to Use Term Ranking

**Files:**
- Modify: `apps/api/src/routes/search.ts`

**Step 1: Use the new function**

```typescript
import { hybridSearchWithTermRanking } from '../services/search.js';

// In the /api/search handler, replace hybridSearch with:
const results = await hybridSearchWithTermRanking(
  c.env.DB,
  c.env.VECTORIZE,
  c.env.AI,
  plan,
  limit
);
```

**Step 2: Include historical flag in response**

```typescript
return c.json({
  results: results.map(r => ({
    ...r.course,
    _score: r.score,
    _semanticRank: r.semanticRank,
    _keywordRank: r.keywordRank,
    _historical: r.historical  // NEW
  })),
  meta: {
    total: results.length,
    plan,
    extracted,
    ambiguities: plan.ambiguities  // NEW
  }
});
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/search.ts
git commit -m "feat(api): include historical flag and ambiguities in response"
```

---

## Final: Deploy and Verify

### Task 7.1: Deploy to Production

**Step 1: Run all tests**

```bash
npm test --workspaces
```

**Step 2: Deploy API**

```bash
cd apps/api && npx wrangler deploy
```

**Step 3: Deploy Web**

```bash
cd apps/web && npm run build && npx wrangler pages deploy dist
```

**Step 4: Verify**

```bash
# Test CS 225 lookup
curl "https://uiuc-course-search.lumirth.workers.dev/api/search?q=CS%20225" | jq '.results[0] | {subject, number, title}'

# Expected:
# { "subject": "CS", "number": "225", "title": "Data Structures" }
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: smart query extraction v1 complete"
git push origin main
```

---

## Summary

| Phase | Description | Tasks |
|-------|-------------|-------|
| 1 | Course Code Recognition | 1.1 - 1.5 |
| 2 | sections_fts | 2.1 - 2.2 |
| 3 | Instructor Schema Fix | 3.1 - 3.2 |
| 4 | Additional Patterns | 4.1 - 4.3 |
| 5 | Subject Aliases | 5.1 - 5.2 |
| 6 | Term Prioritization | 6.1 - 6.2 |
| 7 | Deploy | 7.1 |

Total: ~25 bite-sized steps across 7 phases.
