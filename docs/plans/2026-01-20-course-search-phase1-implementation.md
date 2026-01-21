# Course Search Engine Phase 1: Core Infrastructure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up the foundational Cloudflare infrastructure for the UIUC course search engine with D1 database, Vectorize index, Queues, and basic CISAPI sync.

**Architecture:** Cloudflare Workers with D1 (SQLite) for structured data, Vectorize for semantic search embeddings, and Queues for background sync jobs. The worker fetches course data from CISAPI and stores it for search.

**Tech Stack:** Cloudflare Workers, D1, Vectorize, Queues, TypeScript, Vitest, wrangler CLI

**Project Location:** `/Users/lu/uiuc-course-search/`

**Reference:** Design spec at `/Users/lu/cisapp/docs/plans/2026-01-19-course-search-engine-design.md`

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Create project directory and initialize**

```bash
mkdir -p /Users/lu/uiuc-course-search
cd /Users/lu/uiuc-course-search
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install -D wrangler typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
npm install hono
```

Note: Using Hono as the web framework (lightweight, built for Workers).

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create initial wrangler.toml**

```toml
name = "uiuc-course-search"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
CURRENT_YEAR = "2025"
CURRENT_TERM = "fall"
CISAPI_BASE = "https://courses.illinois.edu/cisapp/explorer"
```

**Step 5: Create minimal src/index.ts**

```typescript
import { Hono } from 'hono';

type Bindings = {
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

export default app;
```

**Step 6: Verify local dev server starts**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler dev
```

Expected: Server starts on localhost:8787, GET / returns JSON with status.

**Step 7: Commit**

```bash
git init
echo "node_modules/\n.wrangler/\n.dev.vars" > .gitignore
git add .
git commit -m "feat: initialize cloudflare workers project with hono

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: D1 Database Setup

**Files:**
- Create: `src/db/schema.sql`
- Modify: `wrangler.toml`
- Create: `src/db/index.ts`

**Step 1: Create D1 database via wrangler**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler d1 create course-search-db
```

Expected: Output includes database_id. Copy this ID.

**Step 2: Update wrangler.toml with D1 binding**

Add to wrangler.toml (replace DATABASE_ID with actual ID from step 1):

```toml
[[d1_databases]]
binding = "DB"
database_name = "course-search-db"
database_id = "DATABASE_ID_HERE"
```

**Step 3: Create schema.sql**

Create `src/db/schema.sql`:

```sql
-- Core course table
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,              -- "CS-225-2025-fall"
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    credit_hours INTEGER,
    gened TEXT,                       -- "QR", "HUM", etc.
    year INTEGER NOT NULL,
    term TEXT NOT NULL,

    -- Enrichment (populated later)
    avg_gpa REAL,
    gpa_sample_size INTEGER,
    primary_instructor TEXT,
    primary_instructor_rmp REAL,

    -- Computed scores
    difficulty_score REAL,
    quality_score REAL,

    -- Sync metadata
    last_synced INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),

    UNIQUE(subject, number, year, term)
);

-- Sections table
CREATE TABLE IF NOT EXISTS sections (
    crn TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    section_number TEXT,

    -- Status
    status TEXT,                      -- "Open", "Closed", "Restricted", "Unknown"

    -- Schedule
    type TEXT,                        -- "Lecture", "Discussion", "Lab"
    days TEXT,                        -- "MWF", "TR"
    start_time TEXT,                  -- "09:00"
    end_time TEXT,                    -- "09:50"
    location TEXT,

    -- Instructor
    instructor TEXT,
    instructor_rmp REAL,
    instructor_gpa REAL,

    last_synced INTEGER,

    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- GPA statistics
CREATE TABLE IF NOT EXISTS gpa_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor TEXT,                  -- NULL = course average

    avg_gpa REAL,
    median_gpa REAL,
    sample_size INTEGER,

    last_updated INTEGER,

    UNIQUE(subject, number, instructor)
);

-- RMP cache
CREATE TABLE IF NOT EXISTS rmp_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_name TEXT UNIQUE NOT NULL,

    rmp_id TEXT,
    rating REAL,
    difficulty REAL,
    would_take_again_pct REAL,
    num_ratings INTEGER,
    department TEXT,
    top_tags TEXT,                    -- JSON array

    fetched_at INTEGER,
    expires_at INTEGER
);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,              -- "courses", "gpa", "rmp"
    last_sync INTEGER,
    last_status TEXT,
    items_synced INTEGER
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_courses_subject ON courses(subject);
CREATE INDEX IF NOT EXISTS idx_courses_term ON courses(year, term);
CREATE INDEX IF NOT EXISTS idx_courses_gpa ON courses(avg_gpa);
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_status ON sections(status);
CREATE INDEX IF NOT EXISTS idx_sections_instructor ON sections(instructor);
CREATE INDEX IF NOT EXISTS idx_sections_time ON sections(start_time);
CREATE INDEX IF NOT EXISTS idx_gpa_course ON gpa_stats(subject, number);
CREATE INDEX IF NOT EXISTS idx_rmp_expires ON rmp_cache(expires_at);
```

**Step 4: Apply schema to local D1**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler d1 execute course-search-db --local --file=src/db/schema.sql
```

Expected: Schema applied successfully.

**Step 5: Create db/index.ts with type-safe helpers**

Create `src/db/index.ts`:

```typescript
import type { D1Database } from '@cloudflare/workers-types';

export interface Course {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  credit_hours: number | null;
  gened: string | null;
  year: number;
  term: string;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
  primary_instructor: string | null;
  primary_instructor_rmp: number | null;
  difficulty_score: number | null;
  quality_score: number | null;
  last_synced: number | null;
  created_at: number;
  updated_at: number;
}

export interface Section {
  crn: string;
  course_id: string;
  section_number: string | null;
  status: string | null;
  type: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  instructor: string | null;
  instructor_rmp: number | null;
  instructor_gpa: number | null;
  last_synced: number | null;
}

export function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

export async function upsertCourse(db: D1Database, course: Omit<Course, 'created_at' | 'updated_at'>): Promise<void> {
  await db.prepare(`
    INSERT INTO courses (id, subject, number, title, description, credit_hours, gened, year, term,
                         avg_gpa, gpa_sample_size, primary_instructor, primary_instructor_rmp,
                         difficulty_score, quality_score, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      credit_hours = excluded.credit_hours,
      gened = excluded.gened,
      avg_gpa = excluded.avg_gpa,
      gpa_sample_size = excluded.gpa_sample_size,
      primary_instructor = excluded.primary_instructor,
      primary_instructor_rmp = excluded.primary_instructor_rmp,
      difficulty_score = excluded.difficulty_score,
      quality_score = excluded.quality_score,
      last_synced = excluded.last_synced,
      updated_at = unixepoch()
  `).bind(
    course.id, course.subject, course.number, course.title, course.description,
    course.credit_hours, course.gened, course.year, course.term,
    course.avg_gpa, course.gpa_sample_size, course.primary_instructor, course.primary_instructor_rmp,
    course.difficulty_score, course.quality_score, course.last_synced
  ).run();
}

export async function upsertSection(db: D1Database, section: Section): Promise<void> {
  await db.prepare(`
    INSERT INTO sections (crn, course_id, section_number, status, type, days,
                          start_time, end_time, location, instructor,
                          instructor_rmp, instructor_gpa, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(crn) DO UPDATE SET
      section_number = excluded.section_number,
      status = excluded.status,
      type = excluded.type,
      days = excluded.days,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      location = excluded.location,
      instructor = excluded.instructor,
      instructor_rmp = excluded.instructor_rmp,
      instructor_gpa = excluded.instructor_gpa,
      last_synced = excluded.last_synced
  `).bind(
    section.crn, section.course_id, section.section_number, section.status,
    section.type, section.days, section.start_time, section.end_time,
    section.location, section.instructor, section.instructor_rmp,
    section.instructor_gpa, section.last_synced
  ).run();
}

export async function getCoursesBySubject(db: D1Database, subject: string, year: number, term: string): Promise<Course[]> {
  const result = await db.prepare(`
    SELECT * FROM courses WHERE subject = ? AND year = ? AND term = ?
  `).bind(subject, year, term).all<Course>();
  return result.results;
}

export async function getCourseCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM courses').first<{ count: number }>();
  return result?.count ?? 0;
}
```

**Step 6: Update src/index.ts with DB binding and test endpoint**

```typescript
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';

type Bindings = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

export default app;
```

**Step 7: Test local D1 connection**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler dev
# In another terminal:
curl http://localhost:8787/stats
```

Expected: `{"courses":0}`

**Step 8: Commit**

```bash
git add .
git commit -m "feat: add D1 database schema and connection

- Create courses, sections, gpa_stats, rmp_cache tables
- Add type-safe upsert helpers
- Add /stats endpoint for course count

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: CISAPI Client

**Files:**
- Create: `src/cisapi/client.ts`
- Create: `src/cisapi/types.ts`
- Create: `src/cisapi/parser.ts`

**Step 1: Create CISAPI types**

Create `src/cisapi/types.ts`:

```typescript
export interface CISAPISubject {
  id: string;           // "CS"
  href: string;         // Full URL to subject endpoint
  label?: string;       // "Computer Science" (from some endpoints)
}

export interface CISAPICourse {
  id: string;           // "225"
  href: string;
  label: string;        // "Data Structures"
  subject: string;      // "CS" (added during parsing)
}

export interface CISAPISection {
  crn: string;
  sectionNumber: string;
  statusCode: string;
  partOfTerm: string;
  sectionStatusCode: string;
  enrollmentStatus: string;
  startDate: string;
  endDate: string;
  meetings: CISAPIMeeting[];
}

export interface CISAPIMeeting {
  type: string;
  typeCode: string;
  start: string;        // "09:00 AM"
  end: string;          // "09:50 AM"
  daysOfTheWeek: string;
  roomNumber: string;
  buildingName: string;
  instructors: CISAPIInstructor[];
}

export interface CISAPIInstructor {
  firstName: string;
  lastName: string;
}

export interface CISAPICourseDetail {
  id: string;
  subjectId: string;
  label: string;
  description: string;
  creditHours: string;
  courseSectionInformation: string;
  classScheduleInformation: string;
  genEdCategories: CISAPIGenEd[];
  sections: CISAPISection[];
}

export interface CISAPIGenEd {
  id: string;
  description: string;
}
```

**Step 2: Create XML parser for CISAPI responses**

Create `src/cisapi/parser.ts`:

```typescript
import type {
  CISAPISubject,
  CISAPICourse,
  CISAPICourseDetail,
  CISAPISection,
  CISAPIMeeting,
  CISAPIInstructor,
  CISAPIGenEd
} from './types.js';

// Simple XML parser for Workers (no external dependencies)
// CISAPI returns well-formed XML, so we can use regex-based parsing

export function parseSubjectsXml(xml: string): CISAPISubject[] {
  const subjects: CISAPISubject[] = [];
  const subjectRegex = /<subject\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>([^<]*)<\/subject>/g;

  let match;
  while ((match = subjectRegex.exec(xml)) !== null) {
    subjects.push({
      id: match[1],
      href: match[2],
      label: match[3] || undefined
    });
  }

  return subjects;
}

export function parseCoursesXml(xml: string, subjectId: string): CISAPICourse[] {
  const courses: CISAPICourse[] = [];
  const courseRegex = /<course\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>([^<]*)<\/course>/g;

  let match;
  while ((match = courseRegex.exec(xml)) !== null) {
    courses.push({
      id: match[1],
      href: match[2],
      label: match[3],
      subject: subjectId
    });
  }

  return courses;
}

export function parseCourseDetailXml(xml: string): CISAPICourseDetail | null {
  // Extract basic course info
  const idMatch = xml.match(/<course\s+id="([^"]+)"/);
  const subjectMatch = xml.match(/<subject\s+id="([^"]+)"/);
  const labelMatch = xml.match(/<label>([^<]+)<\/label>/);
  const descMatch = xml.match(/<description>([^<]*)<\/description>/s);
  const creditMatch = xml.match(/<creditHours>([^<]*)<\/creditHours>/);

  if (!idMatch || !subjectMatch) return null;

  // Parse genEd categories
  const genEdCategories: CISAPIGenEd[] = [];
  const genEdRegex = /<genEdCategory\s+id="([^"]+)"[^>]*>([^<]*)<\/genEdCategory>/g;
  let genEdMatch;
  while ((genEdMatch = genEdRegex.exec(xml)) !== null) {
    genEdCategories.push({
      id: genEdMatch[1],
      description: genEdMatch[2]
    });
  }

  // Parse sections
  const sections = parseSectionsXml(xml);

  return {
    id: idMatch[1],
    subjectId: subjectMatch[1],
    label: labelMatch?.[1] ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    creditHours: creditMatch?.[1] ?? '',
    courseSectionInformation: '',
    classScheduleInformation: '',
    genEdCategories,
    sections
  };
}

function parseSectionsXml(xml: string): CISAPISection[] {
  const sections: CISAPISection[] = [];

  // Match each section block
  const sectionBlockRegex = /<section\s+id="([^"]+)"[^>]*>[\s\S]*?<\/section>/g;
  let sectionMatch;

  while ((sectionMatch = sectionBlockRegex.exec(xml)) !== null) {
    const block = sectionMatch[0];
    const crn = sectionMatch[1];

    const sectionNumberMatch = block.match(/<sectionNumber>([^<]*)<\/sectionNumber>/);
    const statusCodeMatch = block.match(/<statusCode>([^<]*)<\/statusCode>/);
    const enrollmentStatusMatch = block.match(/<enrollmentStatus>([^<]*)<\/enrollmentStatus>/);
    const startDateMatch = block.match(/<startDate>([^<]*)<\/startDate>/);
    const endDateMatch = block.match(/<endDate>([^<]*)<\/endDate>/);
    const partOfTermMatch = block.match(/<partOfTerm>([^<]*)<\/partOfTerm>/);
    const sectionStatusCodeMatch = block.match(/<sectionStatusCode>([^<]*)<\/sectionStatusCode>/);

    const meetings = parseMeetingsXml(block);

    sections.push({
      crn,
      sectionNumber: sectionNumberMatch?.[1] ?? '',
      statusCode: statusCodeMatch?.[1] ?? '',
      enrollmentStatus: enrollmentStatusMatch?.[1] ?? 'Unknown',
      startDate: startDateMatch?.[1] ?? '',
      endDate: endDateMatch?.[1] ?? '',
      partOfTerm: partOfTermMatch?.[1] ?? '',
      sectionStatusCode: sectionStatusCodeMatch?.[1] ?? '',
      meetings
    });
  }

  return sections;
}

function parseMeetingsXml(sectionXml: string): CISAPIMeeting[] {
  const meetings: CISAPIMeeting[] = [];

  const meetingBlockRegex = /<meeting>[\s\S]*?<\/meeting>/g;
  let meetingMatch;

  while ((meetingMatch = meetingBlockRegex.exec(sectionXml)) !== null) {
    const block = meetingMatch[0];

    const typeMatch = block.match(/<type\s+code="([^"]*)"[^>]*>([^<]*)<\/type>/);
    const startMatch = block.match(/<start>([^<]*)<\/start>/);
    const endMatch = block.match(/<end>([^<]*)<\/end>/);
    const daysMatch = block.match(/<daysOfTheWeek>([^<]*)<\/daysOfTheWeek>/);
    const roomMatch = block.match(/<roomNumber>([^<]*)<\/roomNumber>/);
    const buildingMatch = block.match(/<buildingName>([^<]*)<\/buildingName>/);

    const instructors = parseInstructorsXml(block);

    meetings.push({
      type: typeMatch?.[2] ?? '',
      typeCode: typeMatch?.[1] ?? '',
      start: startMatch?.[1] ?? '',
      end: endMatch?.[1] ?? '',
      daysOfTheWeek: daysMatch?.[1] ?? '',
      roomNumber: roomMatch?.[1] ?? '',
      buildingName: buildingMatch?.[1] ?? '',
      instructors
    });
  }

  return meetings;
}

function parseInstructorsXml(meetingXml: string): CISAPIInstructor[] {
  const instructors: CISAPIInstructor[] = [];

  const instructorBlockRegex = /<instructor>[\s\S]*?<\/instructor>/g;
  let instructorMatch;

  while ((instructorMatch = instructorBlockRegex.exec(meetingXml)) !== null) {
    const block = instructorMatch[0];

    const firstNameMatch = block.match(/<firstName>([^<]*)<\/firstName>/);
    const lastNameMatch = block.match(/<lastName>([^<]*)<\/lastName>/);

    if (lastNameMatch) {
      instructors.push({
        firstName: firstNameMatch?.[1] ?? '',
        lastName: lastNameMatch[1]
      });
    }
  }

  return instructors;
}

// Convert time from "09:00 AM" to "09:00" (24h format)
export function convertTo24Hour(time12: string): string {
  if (!time12) return '';

  const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return time12;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes}`;
}
```

**Step 3: Create CISAPI client**

Create `src/cisapi/client.ts`:

```typescript
import type { CISAPISubject, CISAPICourse, CISAPICourseDetail } from './types.js';
import { parseSubjectsXml, parseCoursesXml, parseCourseDetailXml } from './parser.js';

export interface CISAPIClientOptions {
  baseUrl: string;
  year: string;
  term: string;
}

export class CISAPIClient {
  private baseUrl: string;
  private year: string;
  private term: string;

  constructor(options: CISAPIClientOptions) {
    this.baseUrl = options.baseUrl;
    this.year = options.year;
    this.term = options.term;
  }

  private async fetch(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/xml'
      }
    });

    if (!response.ok) {
      throw new Error(`CISAPI request failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    // CISAPI sometimes returns HTML 404 with 200 status
    if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
      throw new Error('CISAPI returned HTML instead of XML (likely 404)');
    }

    return text;
  }

  async getSubjects(): Promise<CISAPISubject[]> {
    const path = `/schedule/${this.year}/${this.term}.xml`;
    const xml = await this.fetch(path);
    return parseSubjectsXml(xml);
  }

  async getCourses(subjectId: string): Promise<CISAPICourse[]> {
    const path = `/schedule/${this.year}/${this.term}/${subjectId}.xml`;
    const xml = await this.fetch(path);
    return parseCoursesXml(xml, subjectId);
  }

  async getCourseDetail(subjectId: string, courseNumber: string): Promise<CISAPICourseDetail | null> {
    const path = `/schedule/${this.year}/${this.term}/${subjectId}/${courseNumber}.xml?mode=cascade`;
    const xml = await this.fetch(path);
    return parseCourseDetailXml(xml);
  }

  async getCourseWithSections(subjectId: string, courseNumber: string): Promise<CISAPICourseDetail | null> {
    return this.getCourseDetail(subjectId, courseNumber);
  }
}
```

**Step 4: Add test endpoint to verify CISAPI client**

Update `src/index.ts` to add a test endpoint:

```typescript
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';

type Bindings = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

// Test endpoint to fetch subjects from CISAPI
app.get('/test/subjects', async (c) => {
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

// Test endpoint to fetch a single course
app.get('/test/course/:subject/:number', async (c) => {
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

export default app;
```

**Step 5: Test CISAPI client locally**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler dev
# In another terminal:
curl http://localhost:8787/test/subjects
curl http://localhost:8787/test/course/CS/225
```

Expected: JSON responses with subjects list and CS 225 course detail.

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add CISAPI client with XML parsing

- Create type definitions for CISAPI responses
- Implement regex-based XML parser for Workers
- Add CISAPIClient with getSubjects, getCourses, getCourseDetail
- Add test endpoints for verification

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Course Sync Service

**Files:**
- Create: `src/services/sync.ts`
- Modify: `src/index.ts`

**Step 1: Create sync service**

Create `src/services/sync.ts`:

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import { CISAPIClient } from '../cisapi/client.js';
import { upsertCourse, upsertSection, makeCourseId, type Course, type Section } from '../db/index.js';
import { convertTo24Hour } from '../cisapi/parser.js';

export interface SyncResult {
  subject: string;
  coursesProcessed: number;
  sectionsProcessed: number;
  errors: string[];
  durationMs: number;
}

export interface SyncOptions {
  year: string;
  term: string;
}

export async function syncSubject(
  db: D1Database,
  client: CISAPIClient,
  subjectId: string,
  options: SyncOptions
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    subject: subjectId,
    coursesProcessed: 0,
    sectionsProcessed: 0,
    errors: [],
    durationMs: 0
  };

  try {
    // Get all courses for this subject
    const courses = await client.getCourses(subjectId);

    for (const course of courses) {
      try {
        // Fetch full course detail with sections
        const detail = await client.getCourseDetail(subjectId, course.id);

        if (!detail) {
          result.errors.push(`No detail found for ${subjectId} ${course.id}`);
          continue;
        }

        const courseId = makeCourseId(subjectId, course.id, parseInt(options.year), options.term);
        const now = Math.floor(Date.now() / 1000);

        // Parse credit hours (could be "3" or "3 to 4")
        const creditHours = parseInt(detail.creditHours) || null;

        // Get primary instructor from first lecture section
        const lectureSection = detail.sections.find(s =>
          s.meetings.some(m => m.typeCode === 'LEC' || m.type === 'Lecture')
        );
        const primaryInstructor = lectureSection?.meetings[0]?.instructors[0];
        const primaryInstructorName = primaryInstructor
          ? `${primaryInstructor.lastName}, ${primaryInstructor.firstName.charAt(0)}`
          : null;

        // Get genEd (first category if any)
        const gened = detail.genEdCategories[0]?.id ?? null;

        // Upsert course
        const courseData: Omit<Course, 'created_at' | 'updated_at'> = {
          id: courseId,
          subject: subjectId,
          number: course.id,
          title: detail.label,
          description: detail.description || null,
          credit_hours: creditHours,
          gened,
          year: parseInt(options.year),
          term: options.term,
          avg_gpa: null,
          gpa_sample_size: null,
          primary_instructor: primaryInstructorName,
          primary_instructor_rmp: null,
          difficulty_score: null,
          quality_score: null,
          last_synced: now
        };

        await upsertCourse(db, courseData);
        result.coursesProcessed++;

        // Upsert sections
        for (const section of detail.sections) {
          const meeting = section.meetings[0];

          const instructorName = meeting?.instructors[0]
            ? `${meeting.instructors[0].lastName}, ${meeting.instructors[0].firstName.charAt(0)}`
            : null;

          const sectionData: Section = {
            crn: section.crn,
            course_id: courseId,
            section_number: section.sectionNumber || null,
            status: section.enrollmentStatus || null,
            type: meeting?.type || null,
            days: meeting?.daysOfTheWeek || null,
            start_time: convertTo24Hour(meeting?.start || '') || null,
            end_time: convertTo24Hour(meeting?.end || '') || null,
            location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() : null,
            instructor: instructorName,
            instructor_rmp: null,
            instructor_gpa: null,
            last_synced: now
          };

          await upsertSection(db, sectionData);
          result.sectionsProcessed++;
        }

      } catch (error) {
        result.errors.push(`Error syncing ${subjectId} ${course.id}: ${String(error)}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error fetching courses for ${subjectId}: ${String(error)}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export async function syncAllSubjects(
  db: D1Database,
  client: CISAPIClient,
  options: SyncOptions
): Promise<{ results: SyncResult[]; totalDurationMs: number }> {
  const startTime = Date.now();
  const results: SyncResult[] = [];

  const subjects = await client.getSubjects();

  for (const subject of subjects) {
    const result = await syncSubject(db, client, subject.id, options);
    results.push(result);
  }

  return {
    results,
    totalDurationMs: Date.now() - startTime
  };
}
```

**Step 2: Add sync endpoints to index.ts**

Update `src/index.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';
import { syncSubject } from './services/sync.js';

type Bindings = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

// Test endpoint to fetch subjects from CISAPI
app.get('/test/subjects', async (c) => {
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

// Test endpoint to fetch a single course
app.get('/test/course/:subject/:number', async (c) => {
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

// Sync a single subject to D1
app.post('/sync/:subject', async (c) => {
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
    });

    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

export default app;
```

**Step 3: Test sync with a small subject**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler dev
# In another terminal:
curl -X POST http://localhost:8787/sync/AAS
curl http://localhost:8787/stats
```

Expected: Sync result showing courses and sections processed, then stats showing non-zero course count.

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add course sync service

- Create syncSubject to fetch and store course data
- Parse instructors, meeting times, enrollment status
- Convert times to 24-hour format
- Add POST /sync/:subject endpoint

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Vectorize Setup

**Files:**
- Modify: `wrangler.toml`
- Create: `src/services/embeddings.ts`
- Modify: `src/services/sync.ts`

**Step 1: Create Vectorize index**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler vectorize create course-embeddings --dimensions=384 --metric=cosine
```

Expected: Output with index name. Note: bge-small-en produces 384-dimensional vectors.

**Step 2: Update wrangler.toml with Vectorize and AI bindings**

Add to wrangler.toml:

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "course-embeddings"

[ai]
binding = "AI"
```

**Step 3: Create embeddings service**

Create `src/services/embeddings.ts`:

```typescript
import type { VectorizeIndex, Ai } from '@cloudflare/workers-types';

export interface CourseEmbeddingData {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  gened: string | null;
  primary_instructor: string | null;
}

// Create text for embedding
function createEmbeddingText(course: CourseEmbeddingData): string {
  const parts = [
    `${course.subject} ${course.number}`,
    course.title,
    course.description || '',
    course.gened ? `GenEd: ${course.gened}` : '',
    course.primary_instructor ? `Instructor: ${course.primary_instructor}` : ''
  ];

  return parts.filter(Boolean).join(' ').slice(0, 512); // Limit length
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = await ai.run('@cf/baai/bge-small-en-v1.5', {
    text: [text]
  });

  // Response is { data: [[...numbers]] }
  return (response as { data: number[][] }).data[0];
}

export async function upsertCourseEmbedding(
  vectorize: VectorizeIndex,
  ai: Ai,
  course: CourseEmbeddingData
): Promise<void> {
  const text = createEmbeddingText(course);
  const embedding = await generateEmbedding(ai, text);

  await vectorize.upsert([{
    id: course.id,
    values: embedding,
    metadata: {
      subject: course.subject,
      number: course.number,
      title: course.title,
      gened: course.gened || ''
    }
  }]);
}

export async function searchCourses(
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  topK: number = 50
): Promise<{ id: string; score: number }[]> {
  const queryEmbedding = await generateEmbedding(ai, query);

  const results = await vectorize.query(queryEmbedding, {
    topK,
    returnMetadata: 'none'
  });

  return results.matches.map(m => ({
    id: m.id,
    score: m.score
  }));
}
```

**Step 4: Update Bindings type and add embedding to sync**

Update the Bindings type in `src/index.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';
import { syncSubject } from './services/sync.js';
import { searchCourses } from './services/embeddings.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

// Test endpoint to fetch subjects from CISAPI
app.get('/test/subjects', async (c) => {
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

// Test endpoint to fetch a single course
app.get('/test/course/:subject/:number', async (c) => {
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

// Sync a single subject to D1
app.post('/sync/:subject', async (c) => {
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

// Semantic search endpoint
app.get('/search/semantic', async (c) => {
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

export default app;
```

**Step 5: Update sync service to generate embeddings**

Update `src/services/sync.ts` to accept Vectorize and AI:

```typescript
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { CISAPIClient } from '../cisapi/client.js';
import { upsertCourse, upsertSection, makeCourseId, type Course, type Section } from '../db/index.js';
import { convertTo24Hour } from '../cisapi/parser.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';

export interface SyncResult {
  subject: string;
  coursesProcessed: number;
  sectionsProcessed: number;
  embeddingsGenerated: number;
  errors: string[];
  durationMs: number;
}

export interface SyncOptions {
  year: string;
  term: string;
}

export async function syncSubject(
  db: D1Database,
  client: CISAPIClient,
  subjectId: string,
  options: SyncOptions,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    subject: subjectId,
    coursesProcessed: 0,
    sectionsProcessed: 0,
    embeddingsGenerated: 0,
    errors: [],
    durationMs: 0
  };

  try {
    // Get all courses for this subject
    const courses = await client.getCourses(subjectId);

    for (const course of courses) {
      try {
        // Fetch full course detail with sections
        const detail = await client.getCourseDetail(subjectId, course.id);

        if (!detail) {
          result.errors.push(`No detail found for ${subjectId} ${course.id}`);
          continue;
        }

        const courseId = makeCourseId(subjectId, course.id, parseInt(options.year), options.term);
        const now = Math.floor(Date.now() / 1000);

        // Parse credit hours (could be "3" or "3 to 4")
        const creditHours = parseInt(detail.creditHours) || null;

        // Get primary instructor from first lecture section
        const lectureSection = detail.sections.find(s =>
          s.meetings.some(m => m.typeCode === 'LEC' || m.type === 'Lecture')
        );
        const primaryInstructor = lectureSection?.meetings[0]?.instructors[0];
        const primaryInstructorName = primaryInstructor
          ? `${primaryInstructor.lastName}, ${primaryInstructor.firstName.charAt(0)}`
          : null;

        // Get genEd (first category if any)
        const gened = detail.genEdCategories[0]?.id ?? null;

        // Upsert course
        const courseData: Omit<Course, 'created_at' | 'updated_at'> = {
          id: courseId,
          subject: subjectId,
          number: course.id,
          title: detail.label,
          description: detail.description || null,
          credit_hours: creditHours,
          gened,
          year: parseInt(options.year),
          term: options.term,
          avg_gpa: null,
          gpa_sample_size: null,
          primary_instructor: primaryInstructorName,
          primary_instructor_rmp: null,
          difficulty_score: null,
          quality_score: null,
          last_synced: now
        };

        await upsertCourse(db, courseData);
        result.coursesProcessed++;

        // Generate embedding if vectorize and AI are available
        if (vectorize && ai) {
          try {
            const embeddingData: CourseEmbeddingData = {
              id: courseId,
              subject: subjectId,
              number: course.id,
              title: detail.label,
              description: detail.description || null,
              gened,
              primary_instructor: primaryInstructorName
            };

            await upsertCourseEmbedding(vectorize, ai, embeddingData);
            result.embeddingsGenerated++;
          } catch (embError) {
            result.errors.push(`Embedding error for ${courseId}: ${String(embError)}`);
          }
        }

        // Upsert sections
        for (const section of detail.sections) {
          const meeting = section.meetings[0];

          const instructorName = meeting?.instructors[0]
            ? `${meeting.instructors[0].lastName}, ${meeting.instructors[0].firstName.charAt(0)}`
            : null;

          const sectionData: Section = {
            crn: section.crn,
            course_id: courseId,
            section_number: section.sectionNumber || null,
            status: section.enrollmentStatus || null,
            type: meeting?.type || null,
            days: meeting?.daysOfTheWeek || null,
            start_time: convertTo24Hour(meeting?.start || '') || null,
            end_time: convertTo24Hour(meeting?.end || '') || null,
            location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() : null,
            instructor: instructorName,
            instructor_rmp: null,
            instructor_gpa: null,
            last_synced: now
          };

          await upsertSection(db, sectionData);
          result.sectionsProcessed++;
        }

      } catch (error) {
        result.errors.push(`Error syncing ${subjectId} ${course.id}: ${String(error)}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error fetching courses for ${subjectId}: ${String(error)}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
```

**Step 6: Test with remote (needs deployment for AI/Vectorize)**

Note: Workers AI and Vectorize require deployment to test. For local testing, we can skip embeddings.

```bash
cd /Users/lu/uiuc-course-search && npx wrangler dev --remote
# In another terminal:
curl -X POST http://localhost:8787/sync/AAS
curl "http://localhost:8787/search/semantic?q=data+structures"
```

**Step 7: Commit**

```bash
git add .
git commit -m "feat: add Vectorize embeddings for semantic search

- Create embeddings service with bge-small-en-v1.5
- Generate embeddings during course sync
- Add /search/semantic endpoint
- Update sync service to support optional vectorize/AI

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: FTS5 Full-Text Search

**Files:**
- Modify: `src/db/schema.sql`
- Create: `src/services/search.ts`
- Modify: `src/index.ts`

**Step 1: Add FTS5 table to schema**

Add to `src/db/schema.sql`:

```sql
-- Full-text search with trigram tokenizer
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

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS courses_fts_insert AFTER INSERT ON courses BEGIN
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor, gened)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor, new.gened);
END;

CREATE TRIGGER IF NOT EXISTS courses_fts_delete AFTER DELETE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor, gened)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor, old.gened);
END;

CREATE TRIGGER IF NOT EXISTS courses_fts_update AFTER UPDATE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor, gened)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor, old.gened);
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor, gened)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor, new.gened);
END;
```

**Step 2: Create search service with RRF fusion**

Create `src/services/search.ts`:

```typescript
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses as semanticSearch } from './embeddings.js';
import type { Course } from '../db/index.js';

export interface SearchFilters {
  subject?: string;
  minGpa?: number;
  maxGpa?: number;
  credits?: number;
  gened?: string;
  status?: string;
  minStartTime?: string;
  maxStartTime?: string;
}

export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
}

// Reciprocal Rank Fusion constant
const RRF_K = 60;

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank);
}

export async function keywordSearch(
  db: D1Database,
  query: string,
  filters: SearchFilters,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  // Build WHERE clause for filters
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.subject) {
    whereClauses.push('c.subject = ?');
    params.push(filters.subject);
  }
  if (filters.minGpa !== undefined) {
    whereClauses.push('c.avg_gpa >= ?');
    params.push(filters.minGpa);
  }
  if (filters.maxGpa !== undefined) {
    whereClauses.push('c.avg_gpa <= ?');
    params.push(filters.maxGpa);
  }
  if (filters.credits !== undefined) {
    whereClauses.push('c.credit_hours = ?');
    params.push(filters.credits);
  }
  if (filters.gened) {
    whereClauses.push('c.gened = ?');
    params.push(filters.gened);
  }

  const whereClause = whereClauses.length > 0
    ? 'WHERE ' + whereClauses.join(' AND ')
    : '';

  // FTS5 search with BM25 ranking
  const sql = `
    SELECT c.id, bm25(courses_fts) as score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${whereClause}
    ${query ? "AND courses_fts MATCH ?" : ""}
    ORDER BY score
    LIMIT ?
  `;

  const finalParams = [...params];
  if (query) {
    // Escape special FTS5 characters and use phrase matching
    const escapedQuery = query.replace(/['"]/g, '').trim();
    finalParams.push(escapedQuery);
  }
  finalParams.push(limit);

  const result = await db.prepare(sql).bind(...finalParams).all<{ id: string; score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  filters: SearchFilters,
  limit: number = 20
): Promise<SearchResult[]> {
  // Run both searches in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(vectorize, ai, query, 50),
    keywordSearch(db, query, filters, 50)
  ]);

  // Build rank maps
  const semanticRanks = new Map<string, number>();
  semanticResults.forEach((r, i) => semanticRanks.set(r.id, i + 1));

  const keywordRanks = new Map<string, number>();
  keywordResults.forEach((r) => keywordRanks.set(r.id, r.rank));

  // Collect all unique IDs
  const allIds = new Set([...semanticRanks.keys(), ...keywordRanks.keys()]);

  // Calculate RRF scores
  const scores: { id: string; score: number; semanticRank?: number; keywordRank?: number }[] = [];

  for (const id of allIds) {
    let score = 0;
    const semanticRank = semanticRanks.get(id);
    const keywordRank = keywordRanks.get(id);

    if (semanticRank) {
      score += rrfScore(semanticRank);
    }
    if (keywordRank) {
      score += rrfScore(keywordRank);
    }

    scores.push({ id, score, semanticRank, keywordRank });
  }

  // Sort by RRF score and take top results
  scores.sort((a, b) => b.score - a.score);
  const topIds = scores.slice(0, limit);

  if (topIds.length === 0) {
    return [];
  }

  // Fetch full course data
  const placeholders = topIds.map(() => '?').join(',');
  const coursesResult = await db.prepare(`
    SELECT * FROM courses WHERE id IN (${placeholders})
  `).bind(...topIds.map(s => s.id)).all<Course>();

  const courseMap = new Map<string, Course>();
  coursesResult.results.forEach(c => courseMap.set(c.id, c));

  // Return results with scores
  return topIds.map(s => ({
    course: courseMap.get(s.id)!,
    score: s.score,
    semanticRank: s.semanticRank,
    keywordRank: s.keywordRank
  })).filter(r => r.course);
}
```

**Step 3: Add hybrid search endpoint**

Update `src/index.ts` to add the search endpoint:

```typescript
import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';
import { syncSubject } from './services/sync.js';
import { searchCourses } from './services/embeddings.js';
import { hybridSearch, keywordSearch, type SearchFilters } from './services/search.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

// Test endpoint to fetch subjects from CISAPI
app.get('/test/subjects', async (c) => {
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

// Test endpoint to fetch a single course
app.get('/test/course/:subject/:number', async (c) => {
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

// Sync a single subject to D1
app.post('/sync/:subject', async (c) => {
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

// Semantic search endpoint
app.get('/search/semantic', async (c) => {
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

// Keyword search endpoint
app.get('/search/keyword', async (c) => {
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

// Hybrid search endpoint (combines semantic + keyword with RRF)
app.get('/api/search', async (c) => {
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

export default app;
```

**Step 4: Re-apply schema with FTS5**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler d1 execute course-search-db --local --file=src/db/schema.sql
```

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add FTS5 keyword search with RRF fusion

- Add courses_fts virtual table with trigram tokenizer
- Create search service with keywordSearch and hybridSearch
- Implement Reciprocal Rank Fusion for combining results
- Add /api/search endpoint with filter support

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Deploy to Cloudflare

**Step 1: Apply schema to production D1**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler d1 execute course-search-db --remote --file=src/db/schema.sql
```

**Step 2: Deploy worker**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler deploy
```

Expected: Deployment URL printed.

**Step 3: Test production endpoints**

```bash
# Replace with actual deployment URL
curl https://uiuc-course-search.<your-subdomain>.workers.dev/
curl https://uiuc-course-search.<your-subdomain>.workers.dev/health
curl https://uiuc-course-search.<your-subdomain>.workers.dev/test/subjects
```

**Step 4: Sync a test subject to production**

```bash
curl -X POST https://uiuc-course-search.<your-subdomain>.workers.dev/sync/CS
curl https://uiuc-course-search.<your-subdomain>.workers.dev/stats
curl "https://uiuc-course-search.<your-subdomain>.workers.dev/api/search?q=data+structures"
```

**Step 5: Commit and tag**

```bash
git add .
git commit -m "chore: prepare for production deployment

Co-Authored-By: Claude <noreply@anthropic.com>"
git tag v0.1.0-phase1
```

---

## Summary

Phase 1 delivers:
- Cloudflare Workers project with Hono framework
- D1 database with courses, sections, gpa_stats, rmp_cache tables
- CISAPI client with XML parsing
- Course sync service storing data to D1
- Vectorize embeddings for semantic search
- FTS5 keyword search with trigram matching
- Hybrid search using Reciprocal Rank Fusion
- Production deployment

Next phases will add:
- Phase 2: Query parser (Compromise.js)
- Phase 3: Data enrichment (GPA, RMP)
- Phase 4: Queue-based background sync
- Phase 5: Frontend UI
- Phase 6: Polish and monitoring
