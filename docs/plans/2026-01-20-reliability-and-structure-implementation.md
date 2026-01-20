# Reliability and Structure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate silent failures, remove 3x code duplication, and improve iteration speed.

**Architecture:** Replace regex with htmlparser2, extract shared transformers, add observability.

**Tech Stack:** htmlparser2, vitest, Hono, Cloudflare Workers

---

## Task 1: Install htmlparser2

**Files:**
- Modify: `/Users/lu/uiuc-course-search/package.json`

**Step 1: Install htmlparser2**

Run: `cd /Users/lu/uiuc-course-search && npm install htmlparser2`

Expected: Package added to dependencies

**Step 2: Verify installation**

Run: `cd /Users/lu/uiuc-course-search && npm ls htmlparser2`

Expected: Shows htmlparser2 with version

**Step 3: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add package.json package-lock.json && git commit -m "feat: add htmlparser2 for XML parsing"
```

---

## Task 2: Create Shared Transformer Module

**Files:**
- Create: `/Users/lu/uiuc-course-search/src/transforms/course.ts`
- Reference: `/Users/lu/uiuc-course-search/src/db/index.ts` (for types)

**Step 1: Write the failing test**

Create `/Users/lu/uiuc-course-search/src/transforms/__tests__/course.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatInstructorName, fromSubjectCascade, type CourseWithSections } from '../course.js';
import type { ParsedSubjectCascade } from '../../cisapi/parser.js';

describe('formatInstructorName', () => {
  it('formats full name as "LastName, F"', () => {
    const result = formatInstructorName({ firstName: 'Wade', lastName: 'Fagen-Ulmschneider' });
    expect(result).toBe('Fagen-Ulmschneider, W');
  });

  it('handles missing firstName', () => {
    const result = formatInstructorName({ firstName: '', lastName: 'Smith' });
    expect(result).toBe('Smith');
  });

  it('returns null for undefined instructor', () => {
    const result = formatInstructorName(undefined);
    expect(result).toBeNull();
  });
});

describe('fromSubjectCascade', () => {
  const sampleParsed: ParsedSubjectCascade = {
    subjectId: 'CS',
    subjectLabel: 'Computer Science',
    courses: [
      {
        id: '225',
        subject: 'CS',
        title: 'Data Structures',
        description: 'Learn data structures.',
        creditHours: '4',
        genEdCategories: ['QR'],
        sections: [
          {
            crn: '12345',
            sectionNumber: 'AL1',
            enrollmentStatus: 'Open',
            type: 'Lecture',
            startTime: '09:00',
            endTime: '09:50',
            daysOfTheWeek: 'MWF',
            buildingName: 'Siebel',
            roomNumber: '1404',
            instructors: [{ firstName: 'Wade', lastName: 'Fagen' }]
          },
          {
            crn: '12346',
            sectionNumber: 'AYA',
            enrollmentStatus: 'Closed',
            type: 'Discussion',
            startTime: '10:00',
            endTime: '10:50',
            daysOfTheWeek: 'T',
            buildingName: 'Siebel',
            roomNumber: '0218',
            instructors: []
          }
        ]
      }
    ]
  };

  it('transforms parsed cascade to CourseWithSections array', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');

    expect(result).toHaveLength(1);
    expect(result[0].course.id).toBe('CS-225-2026-spring');
    expect(result[0].course.subject).toBe('CS');
    expect(result[0].course.number).toBe('225');
    expect(result[0].course.title).toBe('Data Structures');
  });

  it('sets primary_instructor from first lecture section', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].course.primary_instructor).toBe('Fagen, W');
  });

  it('transforms all sections', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].sections).toHaveLength(2);
    expect(result[0].sections[0].crn).toBe('12345');
    expect(result[0].sections[1].crn).toBe('12346');
  });

  it('formats section location correctly', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].sections[0].location).toBe('Siebel 1404');
  });

  it('sets gened from first category', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].course.gened).toBe('QR');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/transforms/__tests__/course.test.ts`

Expected: FAIL - module not found (course.ts doesn't exist)

**Step 3: Create transforms directory and implement**

Create `/Users/lu/uiuc-course-search/src/transforms/course.ts`:

```typescript
import type { ParsedSubjectCascade, ParsedCascadeSection } from '../cisapi/parser.js';
import type { Course, Section } from '../db/index.js';
import { makeCourseId } from '../db/index.js';

export interface CourseWithSections {
  course: Omit<Course, 'created_at' | 'updated_at'>;
  sections: Section[];
}

export function formatInstructorName(
  instructor: { firstName: string; lastName: string } | undefined
): string | null {
  if (!instructor) return null;
  const first = instructor.firstName?.charAt(0);
  return first
    ? `${instructor.lastName}, ${first}`
    : instructor.lastName;
}

export function fromSubjectCascade(
  parsed: ParsedSubjectCascade,
  year: number,
  term: string
): CourseWithSections[] {
  const now = Math.floor(Date.now() / 1000);

  return parsed.courses.map(c => {
    const courseId = makeCourseId(parsed.subjectId, c.id, year, term);

    // Find primary section (prefer lecture)
    const primarySection = c.sections.find(s =>
      s.type.toLowerCase().includes('lecture') || s.type.toLowerCase().includes('lec')
    ) ?? c.sections[0];

    return {
      course: {
        id: courseId,
        subject: parsed.subjectId,
        number: c.id,
        title: c.title,
        description: c.description || null,
        credit_hours: parseInt(c.creditHours) || null,
        gened: c.genEdCategories[0] ?? null,
        year,
        term,
        primary_instructor: formatInstructorName(primarySection?.instructors[0]),
        last_synced: now,
        avg_gpa: null,
        gpa_sample_size: null,
        primary_instructor_rmp: null,
        difficulty_score: null,
        quality_score: null,
      },
      sections: c.sections.map(s => ({
        crn: s.crn,
        course_id: courseId,
        section_number: s.sectionNumber || null,
        status: s.enrollmentStatus || null,
        type: s.type || null,
        days: s.daysOfTheWeek || null,
        start_time: s.startTime || null,
        end_time: s.endTime || null,
        location: `${s.buildingName} ${s.roomNumber}`.trim() || null,
        instructor: formatInstructorName(s.instructors[0]),
        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: now,
      }))
    };
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/transforms/__tests__/course.test.ts`

Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/transforms/ && git commit -m "feat: add shared course transformer to eliminate duplication"
```

---

## Task 3: Migrate Parser to htmlparser2

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/cisapi/parser.ts`
- Test: `/Users/lu/uiuc-course-search/src/cisapi/__tests__/parser.test.ts` (existing)

**Step 1: Read current parser tests**

The existing tests in `parser.test.ts` will serve as regression tests. We need to ensure they still pass after the migration.

**Step 2: Run existing tests to confirm they pass**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/cisapi/__tests__/parser.test.ts`

Expected: All 9 tests PASS

**Step 3: Add error handling test**

Add to `/Users/lu/uiuc-course-search/src/cisapi/__tests__/parser.test.ts`:

```typescript
describe('parseSubjectCascadeXml - error handling', () => {
  it('throws on malformed XML', () => {
    expect(() => parseSubjectCascadeXml('<broken')).toThrow();
  });

  it('throws on completely invalid input', () => {
    expect(() => parseSubjectCascadeXml('not xml at all')).toThrow();
  });
});
```

**Step 4: Run test to verify error handling fails**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/cisapi/__tests__/parser.test.ts`

Expected: FAIL - current regex parser returns null instead of throwing

**Step 5: Rewrite parseSubjectCascadeXml with htmlparser2**

Replace the implementation in `/Users/lu/uiuc-course-search/src/cisapi/parser.ts`. Keep all existing types and the `convertTo24Hour` function. Replace `parseSubjectCascadeXml` and `parseCascadeSections`:

```typescript
import { Parser } from 'htmlparser2';

// ... keep existing types (ParsedSubjectCascade, ParsedCascadeCourse, ParsedCascadeSection) ...
// ... keep convertTo24Hour function ...

export function parseSubjectCascadeXml(xml: string): ParsedSubjectCascade {
  const result: ParsedSubjectCascade = { subjectId: '', subjectLabel: '', courses: [] };
  let currentCourse: ParsedCascadeCourse | null = null;
  let currentSection: ParsedCascadeSection | null = null;
  let currentInstructor: { firstName: string; lastName: string } | null = null;
  let currentText = '';
  let currentTag = '';
  let inMeeting = false;
  let parseError: Error | null = null;

  const parser = new Parser({
    onopentag(name, attrs) {
      currentTag = name;
      currentText = '';

      if (name === 'ns2:subject') {
        result.subjectId = attrs.id || '';
      }
      if (name === 'cascadingCourse') {
        const courseId = (attrs.id || '').split(' ').pop() ?? attrs.id;
        currentCourse = {
          id: courseId,
          subject: result.subjectId,
          title: '',
          description: '',
          creditHours: '',
          genEdCategories: [],
          sections: []
        };
        result.courses.push(currentCourse);
      }
      if (name === 'detailedSection' && currentCourse) {
        currentSection = {
          crn: attrs.id || '',
          sectionNumber: '',
          enrollmentStatus: '',
          type: '',
          startTime: '',
          endTime: '',
          daysOfTheWeek: '',
          buildingName: '',
          roomNumber: '',
          instructors: []
        };
        currentCourse.sections.push(currentSection);
      }
      if (name === 'meeting') {
        inMeeting = true;
      }
      if (name === 'instructor' && currentSection) {
        currentInstructor = { firstName: '', lastName: '' };
      }
      if (name === 'category' && currentCourse && attrs.id) {
        currentCourse.genEdCategories.push(attrs.id);
      }
    },
    ontext(text) {
      currentText += text;
    },
    onclosetag(name) {
      const text = currentText.trim();

      // Subject-level
      if (name === 'label' && !currentCourse) {
        result.subjectLabel = text;
      }

      // Course-level fields (when not in a section)
      if (currentCourse && !currentSection) {
        if (name === 'label') currentCourse.title = text;
        if (name === 'description') currentCourse.description = text;
        if (name === 'creditHours') currentCourse.creditHours = text;
      }

      // Section-level fields
      if (currentSection) {
        if (name === 'sectionNumber') currentSection.sectionNumber = text;
        if (name === 'enrollmentStatus') currentSection.enrollmentStatus = text;
      }

      // Meeting-level fields
      if (currentSection && inMeeting) {
        if (name === 'type') currentSection.type = text;
        if (name === 'start') currentSection.startTime = convertTo24Hour(text);
        if (name === 'end') currentSection.endTime = convertTo24Hour(text);
        if (name === 'daysOfTheWeek') currentSection.daysOfTheWeek = text;
        if (name === 'buildingName') currentSection.buildingName = text;
        if (name === 'roomNumber') currentSection.roomNumber = text;
      }

      // Instructor fields
      if (currentInstructor) {
        if (name === 'firstName') currentInstructor.firstName = text;
        if (name === 'lastName') currentInstructor.lastName = text;
        if (name === 'instructor' && currentSection) {
          if (currentInstructor.lastName) {
            currentSection.instructors.push(currentInstructor);
          }
          currentInstructor = null;
        }
      }

      if (name === 'meeting') inMeeting = false;
      if (name === 'detailedSection') currentSection = null;
      if (name === 'cascadingCourse') currentCourse = null;

      currentText = '';
    },
    onerror(error) {
      parseError = error;
    }
  }, { xmlMode: true });

  parser.write(xml);
  parser.end();

  if (parseError) {
    throw parseError;
  }

  if (!result.subjectId) {
    throw new Error('Invalid XML: missing subject id');
  }

  return result;
}
```

**Step 6: Run all parser tests**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/cisapi/__tests__/parser.test.ts`

Expected: All tests PASS (including new error handling tests)

**Step 7: Run all tests to ensure nothing broke**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 8: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/cisapi/parser.ts src/cisapi/__tests__/parser.test.ts && git commit -m "refactor: migrate parseSubjectCascadeXml to htmlparser2

- Replace regex-based parsing with streaming htmlparser2
- Add explicit error handling for malformed XML
- Eliminates catastrophic backtracking risk
- ~2.2ms for 1MB documents (well within 10ms CPU limit)"
```

---

## Task 4: Update parallel-sync.ts to Use Shared Transformer

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/services/parallel-sync.ts`
- Reference: `/Users/lu/uiuc-course-search/src/transforms/course.ts`

**Step 1: Run existing tests as baseline**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 2: Refactor saveSubjectData to use transformer**

Replace the `saveSubjectData` function in `/Users/lu/uiuc-course-search/src/services/parallel-sync.ts`:

```typescript
import { fromSubjectCascade, type CourseWithSections } from '../transforms/course.js';

// ... keep other imports and types ...

async function saveSubjectData(
  db: D1Database,
  parsed: ParsedSubjectCascade,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<{ coursesCount: number; sectionsCount: number }> {
  const coursesWithSections = fromSubjectCascade(parsed, year, term);
  let coursesCount = 0;
  let sectionsCount = 0;

  for (const { course, sections } of coursesWithSections) {
    await upsertCourse(db, course);
    coursesCount++;

    if (vectorize && ai) {
      try {
        const embeddingData: CourseEmbeddingData = {
          id: course.id,
          subject: course.subject,
          number: course.number,
          title: course.title,
          description: course.description,
          gened: course.gened,
          primary_instructor: course.primary_instructor
        };
        await upsertCourseEmbedding(vectorize, ai, embeddingData);
      } catch (e) {
        console.error(`Embedding error for ${course.id}:`, e);
      }
    }

    for (const section of sections) {
      await upsertSection(db, section);
      sectionsCount++;
    }
  }

  return { coursesCount, sectionsCount };
}
```

**Step 3: Run tests to verify nothing broke**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 4: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/services/parallel-sync.ts && git commit -m "refactor: use shared transformer in parallel-sync.ts"
```

---

## Task 5: Add Sync Result Validation

**Files:**
- Create: `/Users/lu/uiuc-course-search/src/services/validation.ts`

**Step 1: Write the failing test**

Create `/Users/lu/uiuc-course-search/src/services/__tests__/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateSyncResult } from '../validation.js';
import type { TermSyncResult } from '../parallel-sync.js';

const baseResult: TermSyncResult = {
  termId: '2026-spring',
  year: 2026,
  term: 'spring',
  subjectResults: [],
  totalCourses: 0,
  totalSections: 0,
  successfulSubjects: 0,
  failedSubjects: 0,
  durationMs: 1000,
  rateLimitHits: 0
};

describe('validateSyncResult', () => {
  it('returns no warnings for healthy sync', () => {
    const result: TermSyncResult = {
      ...baseResult,
      totalCourses: 4500,
      totalSections: 20000,
      successfulSubjects: 180,
      failedSubjects: 0
    };

    const warnings = validateSyncResult(result);
    expect(warnings).toEqual([]);
  });

  it('warns when courses exist but sections are 0 (parser bug)', () => {
    const result: TermSyncResult = {
      ...baseResult,
      totalCourses: 4500,
      totalSections: 0
    };

    const warnings = validateSyncResult(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('CRITICAL');
    expect(warnings[0]).toContain('0 sections');
  });

  it('warns when spring term has too few courses', () => {
    const result: TermSyncResult = {
      ...baseResult,
      term: 'spring',
      totalCourses: 500,
      totalSections: 2000
    };

    const warnings = validateSyncResult(result);
    expect(warnings.some(w => w.includes('Only 500 courses'))).toBe(true);
  });

  it('does not warn for low course count in summer term', () => {
    const result: TermSyncResult = {
      ...baseResult,
      term: 'summer',
      totalCourses: 500,
      totalSections: 2000
    };

    const warnings = validateSyncResult(result);
    expect(warnings.some(w => w.includes('Only 500 courses'))).toBe(false);
  });

  it('warns when subject failure rate exceeds 10%', () => {
    const result: TermSyncResult = {
      ...baseResult,
      totalCourses: 4000,
      totalSections: 18000,
      successfulSubjects: 150,
      failedSubjects: 30
    };

    const warnings = validateSyncResult(result);
    expect(warnings.some(w => w.includes('failed'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/services/__tests__/validation.test.ts`

Expected: FAIL - module not found

**Step 3: Implement validation module**

Create `/Users/lu/uiuc-course-search/src/services/validation.ts`:

```typescript
import type { TermSyncResult } from './parallel-sync.js';

export function validateSyncResult(result: TermSyncResult): string[] {
  const warnings: string[] = [];

  // Critical: Courses synced but 0 sections indicates parser bug
  if (result.totalCourses > 0 && result.totalSections === 0) {
    warnings.push('CRITICAL: Courses synced but 0 sections — parser bug?');
  }

  // Warning: Too few courses for spring/fall (should have 4000+)
  const isMainTerm = result.term === 'spring' || result.term === 'fall';
  if (isMainTerm && result.totalCourses > 0 && result.totalCourses < 1000) {
    warnings.push(`WARNING: Only ${result.totalCourses} courses — expected 4000+`);
  }

  // Warning: High subject failure rate
  const totalSubjects = result.successfulSubjects + result.failedSubjects;
  if (totalSubjects > 0) {
    const failRate = result.failedSubjects / totalSubjects;
    if (failRate > 0.1) {
      warnings.push(`WARNING: ${(failRate * 100).toFixed(0)}% of subjects failed`);
    }
  }

  return warnings;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/lu/uiuc-course-search && npm test -- src/services/__tests__/validation.test.ts`

Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/services/validation.ts src/services/__tests__/validation.test.ts && git commit -m "feat: add sync result validation to catch silent failures"
```

---

## Task 6: Add Health Check Endpoint

**Files:**
- Create: `/Users/lu/uiuc-course-search/src/routes/health.ts`
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts` (add getSectionCount)

**Step 1: Add getSectionCount to db/index.ts**

Add to `/Users/lu/uiuc-course-search/src/db/index.ts`:

```typescript
export async function getSectionCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM sections').first<{ count: number }>();
  return result?.count ?? 0;
}
```

**Step 2: Create health routes module**

Create `/Users/lu/uiuc-course-search/src/routes/health.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { getCourseCount, getSectionCount } from '../db/index.js';

type Bindings = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

healthRoutes.get('/health', (c) => c.json({ healthy: true }));

healthRoutes.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

healthRoutes.get('/health/data', async (c) => {
  const courses = await getCourseCount(c.env.DB);
  const sections = await getSectionCount(c.env.DB);

  const healthy = courses > 1000 && sections > 0 && (sections / courses) > 1;

  return c.json({
    healthy,
    courses,
    sections,
    sectionsPerCourse: courses > 0 ? (sections / courses).toFixed(1) : '0',
    warning: sections === 0 ? 'No sections in database' : null
  }, healthy ? 200 : 500);
});
```

**Step 3: Run all tests**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 4: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/db/index.ts src/routes/health.ts && git commit -m "feat: add /health/data endpoint for data quality monitoring"
```

---

## Task 7: Create Route Modules (search, sync, course, debug)

**Files:**
- Create: `/Users/lu/uiuc-course-search/src/routes/search.ts`
- Create: `/Users/lu/uiuc-course-search/src/routes/sync.ts`
- Create: `/Users/lu/uiuc-course-search/src/routes/course.ts`
- Create: `/Users/lu/uiuc-course-search/src/routes/debug.ts`

**Step 1: Create search routes**

Create `/Users/lu/uiuc-course-search/src/routes/search.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses } from '../services/embeddings.js';
import { hybridSearch, keywordSearch, type SearchFilters } from '../services/search.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

searchRoutes.get('/search/semantic', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  try {
    const results = await searchCourses(c.env.VECTORIZE, c.env.AI, query, 20);
    return c.json({ results });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

searchRoutes.get('/search/keyword', async (c) => {
  const query = c.req.query('q') || '';

  const filters: SearchFilters = {
    subject: c.req.query('subject'),
    minGpa: c.req.query('min_gpa') ? parseFloat(c.req.query('min_gpa')!) : undefined,
    maxGpa: c.req.query('max_gpa') ? parseFloat(c.req.query('max_gpa')!) : undefined,
    credits: c.req.query('credits') ? parseInt(c.req.query('credits')!) : undefined,
    gened: c.req.query('gened'),
    status: c.req.query('status')
  };

  try {
    const results = await keywordSearch(c.env.DB, query, filters, 20);
    return c.json({ results });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

searchRoutes.get('/api/search', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  const filters: SearchFilters = {
    subject: c.req.query('subject'),
    minGpa: c.req.query('min_gpa') ? parseFloat(c.req.query('min_gpa')!) : undefined,
    maxGpa: c.req.query('max_gpa') ? parseFloat(c.req.query('max_gpa')!) : undefined,
    credits: c.req.query('credits') ? parseInt(c.req.query('credits')!) : undefined,
    gened: c.req.query('gened'),
    status: c.req.query('status')
  };

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

  try {
    const results = await hybridSearch(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      query,
      filters,
      limit
    );

    return c.json({
      results: results.map(r => ({
        ...r.course,
        _score: r.score,
        _semanticRank: r.semanticRank,
        _keywordRank: r.keywordRank
      })),
      meta: {
        total: results.length,
        query
      }
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
```

**Step 2: Create sync routes**

Create `/Users/lu/uiuc-course-search/src/routes/sync.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { CISAPIClient } from '../cisapi/client.js';
import { syncSubject } from '../services/sync.js';
import { syncTerm } from '../services/parallel-sync.js';
import { validateSyncResult } from '../services/validation.js';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { getTermsByStatus, upsertTermState, makeTermId } from '../db/index.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;
  SYNC_CONCURRENCY: string;
};

export const syncRoutes = new Hono<{ Bindings: Bindings }>();

syncRoutes.post('/sync/:subject', async (c) => {
  const { subject } = c.req.param();

  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const result = await syncSubject(c.env.DB, client, subject, {
      year: c.env.CURRENT_YEAR,
      term: c.env.CURRENT_TERM
    }, c.env.VECTORIZE, c.env.AI);

    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncRoutes.post('/admin/discover-terms', async (c) => {
  const config = {
    frontendBase: c.env.FRONTEND_BASE,
    cisapiBase: c.env.CISAPI_BASE,
  };

  try {
    const classifications = await discoverAndClassifyTerms(c.env.DB, config);
    return c.json({
      discovered: classifications.length,
      terms: classifications.map(cl => ({
        termId: cl.term.termId,
        year: cl.term.year,
        term: cl.term.term,
        status: cl.status,
        sampleStatuses: cl.sampleEnrollmentStatuses
      }))
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncRoutes.get('/admin/terms', async (c) => {
  const status = c.req.query('status') as 'active' | 'historical' | undefined;

  try {
    if (status) {
      const terms = await getTermsByStatus(c.env.DB, status);
      return c.json({ terms });
    }

    const active = await getTermsByStatus(c.env.DB, 'active');
    const historical = await getTermsByStatus(c.env.DB, 'historical');
    return c.json({ active, historical });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncRoutes.post('/admin/sync/:year/:term', async (c) => {
  const { year, term } = c.req.param();
  const offset = parseInt(c.req.query('offset') || '0');
  const limit = parseInt(c.req.query('limit') || '20');

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset,
    limit,
  };

  try {
    const result = await syncTerm(
      c.env.DB,
      config,
      parseInt(year),
      term,
      c.env.VECTORIZE,
      c.env.AI
    );

    const warnings = validateSyncResult(result);

    await upsertTermState(c.env.DB, {
      term_id: makeTermId(parseInt(year), term),
      year: parseInt(year),
      term,
      status: 'active',
      last_checked: Math.floor(Date.now() / 1000),
      last_synced: Math.floor(Date.now() / 1000),
      subjects_count: result.successfulSubjects + result.failedSubjects,
      courses_count: result.totalCourses,
      sections_count: result.totalSections,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });

    return c.json({ ...result, warnings });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncRoutes.post('/admin/sync-active', async (c) => {
  const activeTerms = await getTermsByStatus(c.env.DB, 'active');

  if (activeTerms.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  const offset = parseInt(c.req.query('offset') || '0');
  const limit = parseInt(c.req.query('limit') || '20');

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset,
    limit,
  };

  const results = [];
  for (const termState of activeTerms) {
    const result = await syncTerm(
      c.env.DB,
      config,
      termState.year,
      termState.term,
      c.env.VECTORIZE,
      c.env.AI
    );

    const warnings = validateSyncResult(result);

    results.push({ ...result, warnings });

    await upsertTermState(c.env.DB, {
      ...termState,
      last_synced: Math.floor(Date.now() / 1000),
      courses_count: result.totalCourses,
      sections_count: result.totalSections,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });
  }

  return c.json({ results });
});
```

**Step 3: Create course routes**

Create `/Users/lu/uiuc-course-search/src/routes/course.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { CISAPIClient } from '../cisapi/client.js';
import { makeCourseId, type Course, type Section } from '../db/index.js';
import { getRateLimiter } from '../services/rate-limiter.js';
import { browserFetch } from '../http/browser-fetch.js';
import { parseCourseDetailXml, convertTo24Hour } from '../cisapi/parser.js';
import { upsertCourse, upsertSection } from '../db/index.js';

type Bindings = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
};

export const courseRoutes = new Hono<{ Bindings: Bindings }>();

courseRoutes.get('/test/subjects', async (c) => {
  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const subjects = await client.getSubjects();
    return c.json({
      count: subjects.length,
      sample: subjects.slice(0, 5)
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

courseRoutes.get('/test/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();

  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const course = await client.getCourseDetail(subject, number);
    return c.json(course);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

courseRoutes.get('/api/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();
  const year = c.req.query('year') || c.env.CURRENT_YEAR;
  const term = c.req.query('term') || c.env.CURRENT_TERM;

  const cacheHeader = c.req.header('Cache-Control');
  const bypassCache = cacheHeader?.includes('no-cache') || c.req.query('fresh') === 'true';

  const cacheTtl = parseInt(c.env.CLIENT_CACHE_TTL_MS) || 30000;
  const courseId = makeCourseId(subject, number, parseInt(year), term);

  // If not bypassing cache, check if we have recent data
  if (!bypassCache) {
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing && existing.age_seconds * 1000 < cacheTtl) {
      const sections = await c.env.DB.prepare(
        'SELECT * FROM sections WHERE course_id = ?'
      ).bind(courseId).all<Section>();

      return c.json({
        ...existing,
        sections: sections.results,
        _cached: true,
        _age_seconds: existing.age_seconds
      }, 200, {
        'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
        'X-Cache': 'HIT'
      });
    }
  }

  // Check rate limiter
  const rateLimiter = getRateLimiter({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = rateLimiter.getState();
  if (state.isBackingOff) {
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing) {
      const sections = await c.env.DB.prepare(
        'SELECT * FROM sections WHERE course_id = ?'
      ).bind(courseId).all<Section>();

      return c.json({
        ...existing,
        sections: sections.results,
        _stale: true,
        _stale_reason: rateLimiter.getErrorMessage(),
        _age_seconds: existing.age_seconds
      }, 200, {
        'X-Cache': 'STALE',
        'X-Stale-Reason': 'rate-limited'
      });
    }

    return c.json({
      error: 'Rate limited and no cached data available',
      retryAfter: state.backoffUntil ? Math.ceil((state.backoffUntil - Date.now()) / 1000) : null
    }, 503);
  }

  // Fetch fresh data
  try {
    await rateLimiter.waitIfNeeded();

    const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}/${subject}/${number}.xml?mode=cascade`;
    const response = await browserFetch(url);

    if (!response.ok) {
      if (rateLimiter.isRateLimited(response.status)) {
        rateLimiter.recordFailure(`${subject} ${number}: ${response.status}`, response.status);
      }
      return c.json({ error: `Course not found: ${response.status}` }, 404);
    }

    rateLimiter.recordSuccess();

    const xml = await response.text();

    if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
      return c.json({ error: 'Course not found' }, 404);
    }

    const parsed = parseCourseDetailXml(xml);

    if (!parsed) {
      return c.json({ error: 'Failed to parse course data' }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const creditHours = parseInt(parsed.creditHours) || null;

    const lectureSection = parsed.sections.find(s =>
      s.meetings.some(m => m.typeCode === 'LEC' || m.type === 'Lecture')
    );
    const primaryInstructor = lectureSection?.meetings[0]?.instructors[0];
    const primaryInstructorName = primaryInstructor
      ? `${primaryInstructor.lastName}${primaryInstructor.firstName ? `, ${primaryInstructor.firstName.charAt(0)}` : ''}`
      : null;

    await upsertCourse(c.env.DB, {
      id: courseId,
      subject,
      number,
      title: parsed.label,
      description: parsed.description || null,
      credit_hours: creditHours,
      gened: parsed.genEdCategories[0]?.id ?? null,
      year: parseInt(year),
      term,
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: primaryInstructorName,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      last_synced: now
    });

    const sectionResults = [];
    for (const section of parsed.sections) {
      const meeting = section.meetings[0];
      const instructorName = meeting?.instructors[0]
        ? `${meeting.instructors[0].lastName}${meeting.instructors[0].firstName ? `, ${meeting.instructors[0].firstName.charAt(0)}` : ''}`
        : null;

      await upsertSection(c.env.DB, {
        crn: section.crn,
        course_id: courseId,
        section_number: section.sectionNumber || null,
        status: section.enrollmentStatus || null,
        type: meeting?.type || null,
        days: meeting?.daysOfTheWeek || null,
        start_time: convertTo24Hour(meeting?.start || '') || null,
        end_time: convertTo24Hour(meeting?.end || '') || null,
        location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() || null : null,
        instructor: instructorName,
        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: now
      });

      sectionResults.push({
        crn: section.crn,
        sectionNumber: section.sectionNumber,
        enrollmentStatus: section.enrollmentStatus,
        type: meeting?.type,
        days: meeting?.daysOfTheWeek,
        startTime: convertTo24Hour(meeting?.start || '') || null,
        endTime: convertTo24Hour(meeting?.end || '') || null,
        location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() || null : null,
        instructor: instructorName
      });
    }

    return c.json({
      id: courseId,
      subject,
      number,
      title: parsed.label,
      description: parsed.description,
      credit_hours: creditHours,
      gened: parsed.genEdCategories[0]?.id ?? null,
      year: parseInt(year),
      term,
      primary_instructor: primaryInstructorName,
      sections: sectionResults,
      _cached: false,
      _fetched_at: now
    }, 200, {
      'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
      'X-Cache': 'MISS'
    });

  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500);
  }
});
```

**Step 4: Create debug routes**

Create `/Users/lu/uiuc-course-search/src/routes/debug.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { browserFetch, BROWSER_HEADERS } from '../http/browser-fetch.js';
import { getRateLimiter, resetRateLimiter } from '../services/rate-limiter.js';

type Bindings = {
  DB: D1Database;
  CISAPI_BASE: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
};

export const debugRoutes = new Hono<{ Bindings: Bindings }>();

debugRoutes.get('/admin/rate-limit-status', (c) => {
  const rateLimiter = getRateLimiter({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = rateLimiter.getState();
  const errorMessage = rateLimiter.getErrorMessage();
  const staleWarning = rateLimiter.getStaleDataWarning();

  return c.json({
    ...state,
    errorMessage,
    staleWarning,
  });
});

debugRoutes.get('/admin/debug/fetch', async (c) => {
  const testUrl = c.req.query('url');
  const useBrowserHeaders = c.req.query('browser') !== 'false';

  if (!testUrl) {
    return c.json({ error: 'Missing ?url= parameter' });
  }

  try {
    const response = useBrowserHeaders
      ? await browserFetch(testUrl)
      : await fetch(testUrl, { headers: { 'Accept': 'application/xml' } });

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });

    const body = await response.text();

    return c.json({
      url: testUrl,
      status: response.status,
      statusText: response.statusText,
      bodyLength: body.length,
      bodySnippet: body.substring(0, 1000),
      headers: respHeaders,
      usedBrowserHeaders: useBrowserHeaders
    });
  } catch (error) {
    return c.json({ error: String(error), url: testUrl });
  }
});

debugRoutes.get('/admin/debug/subjects/:year/:term', async (c) => {
  const { year, term } = c.req.param();
  const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}.xml`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml' },
      redirect: 'follow'
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (!response.ok) {
      return c.json({
        error: `HTTP ${response.status}`,
        url,
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    const xml = await response.text();
    const subjectRegex = /<subject id="([^"]+)"/g;
    const subjects: string[] = [];
    let match;

    while ((match = subjectRegex.exec(xml)) !== null) {
      subjects.push(match[1]);
    }

    return c.json({
      url,
      status: response.status,
      subjectCount: subjects.length,
      subjects: subjects.slice(0, 10),
      xmlLength: xml.length,
      xmlSnippet: xml.substring(0, 500),
      headers
    });
  } catch (error) {
    return c.json({ error: String(error), url });
  }
});

debugRoutes.post('/admin/reset-rate-limiter', (c) => {
  resetRateLimiter();
  return c.json({ message: 'Rate limiter reset' });
});
```

**Step 5: Run all tests**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 6: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/routes/ && git commit -m "refactor: extract route modules from monolithic index.ts"
```

---

## Task 8: Refactor index.ts to Mount Routes

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/index.ts`

**Step 1: Replace index.ts with route mounting**

Replace `/Users/lu/uiuc-course-search/src/index.ts` with:

```typescript
import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';
import { courseRoutes } from './routes/course.js';
import { debugRoutes } from './routes/debug.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;
  SYNC_INTERVAL_MS: string;
  SYNC_CONCURRENCY: string;
  TERM_CHECK_INTERVAL_MS: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.route('/', healthRoutes);
app.route('/', searchRoutes);
app.route('/', syncRoutes);
app.route('/', courseRoutes);
app.route('/', debugRoutes);

export default app;
```

**Step 2: Run all tests**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 3: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add src/index.ts && git commit -m "refactor: simplify index.ts to ~30 lines with route mounting

Before: 630 lines with business logic in route handlers
After: ~30 lines mounting route modules"
```

---

## Task 9: Delete Unused sync.ts

**Files:**
- Delete: `/Users/lu/uiuc-course-search/src/services/sync.ts`
- Modify: `/Users/lu/uiuc-course-search/src/routes/sync.ts` (remove import if still used)

**Step 1: Check if sync.ts is still imported**

The `syncSubject` function from `sync.ts` is still used in the single-subject sync endpoint. We need to keep it OR remove that endpoint. Since the N+1 approach is inefficient, we should remove the single-subject sync endpoint.

**Step 2: Update sync.ts routes to remove syncSubject usage**

Remove the `/sync/:subject` endpoint from `/Users/lu/uiuc-course-search/src/routes/sync.ts` (remove the first route and the `syncSubject` import).

**Step 3: Delete sync.ts**

Run: `rm /Users/lu/uiuc-course-search/src/services/sync.ts`

**Step 4: Run all tests**

Run: `cd /Users/lu/uiuc-course-search && npm test`

Expected: All tests PASS

**Step 5: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add -A && git commit -m "refactor: remove unused N+1 sync.ts in favor of parallel-sync

The cascade approach in parallel-sync.ts is more efficient (1 request
per subject vs N+1 requests per course)."
```

---

## Task 10: Update npm Scripts

**Files:**
- Modify: `/Users/lu/uiuc-course-search/package.json`

**Step 1: Update package.json scripts**

Update the scripts section in `/Users/lu/uiuc-course-search/package.json`:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run test",
    "deploy": "npm run check && wrangler deploy"
  }
}
```

**Step 2: Verify typecheck works**

Run: `cd /Users/lu/uiuc-course-search && npm run typecheck`

Expected: No errors (or fix any type errors)

**Step 3: Verify check works**

Run: `cd /Users/lu/uiuc-course-search && npm run check`

Expected: Typecheck passes, all tests pass

**Step 4: Commit**

```bash
cd /Users/lu/uiuc-course-search && git add package.json && git commit -m "chore: add typecheck and check npm scripts"
```

---

## Success Criteria

- [ ] All tests pass with htmlparser2 parser
- [ ] Zero duplication in course/section transformation (single `fromSubjectCascade`)
- [ ] `/health/data` endpoint returns accurate counts
- [ ] Sync warnings surface in API responses
- [ ] `npm run check` passes before deploy
- [ ] index.ts is ~30 lines mounting route modules
- [ ] sync.ts (N+1 approach) is deleted

---

## Implementation Order Summary

1. Install htmlparser2
2. Create shared transformer module (TDD)
3. Migrate parser to htmlparser2 (TDD)
4. Update parallel-sync.ts to use shared transformer
5. Add sync result validation (TDD)
6. Add health check endpoint
7. Create route modules (search, sync, course, debug)
8. Refactor index.ts to mount routes
9. Delete unused sync.ts
10. Update npm scripts
