# Reliability and Structure Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate silent failures, remove code duplication, and improve iteration speed.

**Architecture:** Migrate from regex to htmlparser2 for XML parsing, extract shared transformers to eliminate 3x duplication, add observability to catch failures immediately.

**Tech Stack:** htmlparser2, vitest, Cloudflare Workers

---

## 1. Parser Migration (Regex → htmlparser2)

### Problem
Current regex-based parsing:
- Has catastrophic backtracking risk with `[\s\S]*?` patterns
- Cannot formally parse nested XML structures
- Fails silently on edge cases

### Solution
Replace with `htmlparser2` streaming parser:
- ~2.2ms for 1MB documents (well within 10ms CPU limit)
- Flat memory usage via streaming
- Explicit error handling on malformed input

### Changes
- Install `htmlparser2` (~30KB, pure JS, no native deps)
- Rewrite `src/cisapi/parser.ts` using htmlparser2
- Keep same output interfaces (`ParsedSubjectCascade`, `ParsedCascadeSection`)

### Implementation

```typescript
import { Parser } from 'htmlparser2';

export function parseSubjectCascade(xml: string): ParsedSubjectCascade {
  const result: ParsedSubjectCascade = { subjectId: '', subjectLabel: '', courses: [] };
  let currentCourse: ParsedCascadeCourse | null = null;
  let currentSection: ParsedCascadeSection | null = null;
  let currentText = '';
  let currentTag = '';

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'ns2:subject') {
        result.subjectId = attrs.id;
      }
      if (name === 'cascadingCourse') {
        const courseId = attrs.id.split(' ').pop() ?? attrs.id;
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
          crn: attrs.id,
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
      if (name === 'category' && currentCourse) {
        currentCourse.genEdCategories.push(attrs.id);
      }
      currentTag = name;
    },
    ontext(text) {
      currentText += text;
    },
    onclosetag(name) {
      const text = currentText.trim();

      // Course-level fields
      if (currentCourse && !currentSection) {
        if (name === 'label') currentCourse.title = text;
        if (name === 'description') currentCourse.description = text;
        if (name === 'creditHours') currentCourse.creditHours = text;
      }

      // Section-level fields
      if (currentSection) {
        if (name === 'sectionNumber') currentSection.sectionNumber = text;
        if (name === 'enrollmentStatus') currentSection.enrollmentStatus = text;
        if (name === 'type') currentSection.type = text;
        if (name === 'start') currentSection.startTime = convertTo24Hour(text);
        if (name === 'end') currentSection.endTime = convertTo24Hour(text);
        if (name === 'daysOfTheWeek') currentSection.daysOfTheWeek = text;
        if (name === 'buildingName') currentSection.buildingName = text;
        if (name === 'roomNumber') currentSection.roomNumber = text;
      }

      if (name === 'detailedSection') currentSection = null;
      if (name === 'cascadingCourse') currentCourse = null;

      currentText = '';
    }
  }, { xmlMode: true });

  parser.write(xml);
  parser.end();
  return result;
}
```

---

## 2. Test Strategy

### Approach
Use real API response fixtures to verify parser works against actual CISAPI structure.

### Fixtures (capture once)
```
src/cisapi/__tests__/
  parser.test.ts
  fixtures/
    subject-cascade-CS.xml    # Real /2026/spring/CS.xml?mode=cascade
    course-detail-CS-225.xml  # Real /2026/spring/CS/225.xml?mode=cascade
```

### Test categories

1. **Reality tests** — Parser works against real responses:
```typescript
test('parses real CS subject cascade', () => {
  const xml = readFixture('subject-cascade-CS.xml');
  const result = parseSubjectCascade(xml);

  expect(result.subjectId).toBe('CS');
  expect(result.courses.length).toBeGreaterThan(80);

  const cs225 = result.courses.find(c => c.id === '225');
  expect(cs225?.sections.length).toBeGreaterThan(10);
});
```

2. **Regression tests** — Bugs we've hit don't recur:
```typescript
test('parses detailedSection elements (regression)', () => {
  const result = parseSubjectCascade(fixture);
  const totalSections = result.courses.reduce((s, c) => s + c.sections.length, 0);
  expect(totalSections).toBeGreaterThan(0);
});
```

3. **Error handling** — Malformed input fails explicitly:
```typescript
test('throws on malformed XML', () => {
  expect(() => parseSubjectCascade('<broken')).toThrow();
});
```

---

## 3. Observability

### Sync result validation

```typescript
// src/services/validation.ts
export function validateSyncResult(result: TermSyncResult): string[] {
  const warnings: string[] = [];

  if (result.totalCourses > 0 && result.totalSections === 0) {
    warnings.push('CRITICAL: Courses synced but 0 sections — parser bug?');
  }

  if (result.totalCourses < 1000 && result.term === 'spring') {
    warnings.push(`WARNING: Only ${result.totalCourses} courses — expected 4000+`);
  }

  const failRate = result.failedSubjects / (result.successfulSubjects + result.failedSubjects);
  if (failRate > 0.1) {
    warnings.push(`WARNING: ${(failRate * 100).toFixed(0)}% of subjects failed`);
  }

  return warnings;
}
```

### Health check endpoint

```typescript
// In routes
app.get('/health/data', async (c) => {
  const courses = await getCourseCount(c.env.DB);
  const sections = await getSectionCount(c.env.DB);

  const healthy = courses > 1000 && sections > 0 && (sections / courses) > 1;

  return c.json({
    healthy,
    courses,
    sections,
    sectionsPerCourse: (sections / courses).toFixed(1),
    warning: sections === 0 ? 'No sections in database' : null
  }, healthy ? 200 : 500);
});
```

---

## 4. Structure (Eliminate Duplication)

### Current state (3x duplication)
| Logic | Location 1 | Location 2 | Location 3 |
|-------|-----------|-----------|-----------|
| Parse → DB record | `index.ts:549-591` | `sync.ts:71-139` | `parallel-sync.ts:91-168` |
| Instructor name formatting | varies | varies | varies |
| Save course + sections | inline | function | function |

### Proposed structure
```
src/cisapi/
  parser.ts              # htmlparser2-based XML parsing
  client.ts              # HTTP client
  types.ts               # API types

src/transforms/
  course.ts              # Parsed XML → DB records (ONE place)
    - fromSubjectCascade()
    - fromCourseDetail()
    - formatInstructorName()

src/db/
  index.ts               # Queries
  save.ts                # saveCourseWithSections()

src/services/
  parallel-sync.ts       # Uses transforms + save
  validation.ts          # Sync result validation
  rate-limiter.ts        # Existing
  search.ts              # Existing
  embeddings.ts          # Existing
  term-discovery.ts      # Existing

src/routes/
  health.ts              # /, /health, /stats, /health/data
  search.ts              # /api/search, /search/*
  sync.ts                # /admin/sync/*
  course.ts              # /api/course/:subject/:number
  debug.ts               # /admin/debug/*

src/index.ts             # Mount routes (~30 lines)
```

### Shared transformer

```typescript
// src/transforms/course.ts
export interface CourseWithSections {
  course: Course;
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
    const primarySection = c.sections.find(s =>
      s.type.toLowerCase().includes('lecture')
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
        // null fields
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

### Delete unused code
- Remove `src/services/sync.ts` (N+1 approach, unused)

---

## 5. Dev Experience

### Split routes
```typescript
// src/index.ts (after refactor)
import { Hono } from 'hono';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { syncRoutes } from './routes/sync.js';
import { courseRoutes } from './routes/course.js';
import { debugRoutes } from './routes/debug.js';

const app = new Hono();

app.route('/', healthRoutes);
app.route('/', searchRoutes);
app.route('/', syncRoutes);
app.route('/', courseRoutes);
app.route('/', debugRoutes);

export default app;
```

### npm scripts
```json
{
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run test",
    "deploy": "npm run check && wrangler deploy",
    "capture-fixtures": "tsx scripts/capture-fixtures.ts"
  }
}
```

### Local replay mode (optional)
For testing without hitting live API:
```typescript
// In CISAPIClient
constructor(options: CISAPIClientOptions & { useFixtures?: boolean }) {
  this.useFixtures = options.useFixtures ?? false;
}

async fetchSubjectCascade(subject: string): Promise<string> {
  if (this.useFixtures) {
    return readFixture(`subject-cascade-${subject}.xml`);
  }
  return this.fetch(`/schedule/${this.year}/${this.term}/${subject}.xml?mode=cascade`);
}
```

---

## Implementation Order

1. **Parser migration** — Highest risk, do first with tests
2. **Shared transformer** — Extract from existing code
3. **Observability** — Add validation + health endpoint
4. **Route splitting** — Low risk, pure refactor
5. **Delete unused code** — sync.ts removal

---

## Success Criteria

- [ ] All tests pass with htmlparser2 parser
- [ ] Zero duplication in course/section transformation
- [ ] `/health/data` returns accurate counts
- [ ] Sync warnings surface in API responses
- [ ] `npm run check` passes before deploy
