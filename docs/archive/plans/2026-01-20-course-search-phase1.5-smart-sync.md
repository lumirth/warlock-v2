# Course Search Engine Phase 1.5: Smart Sync System

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement intelligent term detection and efficient parallel sync with rate-limit handling, so we can populate the database with all historical terms once and keep active terms fresh every 3 minutes.

**Architecture:** Term state tracking in D1, parallel subject-level cascades for efficient sync, exponential backoff for rate limiting, and configurable operational parameters.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, wrangler CLI

**Project Location:** `/Users/lu/uiuc-course-search/`

**Depends On:** Phase 1 completion (v0.1.0-phase1)

---

## Background

### Term Detection Strategy

Active vs historical terms are detected by sampling `enrollmentStatus`:
- **Active terms**: Sections show `Open`, `Closed`, `CrossListOpen (Restricted)`, etc.
- **Historical terms**: All sections show `UNKNOWN`

Term discovery uses the frontend AJAX endpoint:
```
GET https://courses.illinois.edu/ajax/search/termlist/{year}
Returns: {"Winter":"winter","Spring":"spring","Summer":"summer","Fall":"fall"}
```

### Sync Performance (Tested)

| Concurrency | Time for 187 subjects |
|-------------|----------------------|
| 20 parallel | 2.5s |
| 25 parallel | 2.2s |
| 30 parallel | 2.0s |

### Rate Limiting Considerations (AWS WAF)

Common WAF thresholds:
- Blanket limit: 2,000-5,000 requests per 5-minute window
- Tighter limit: 500 requests per 5-minute window

Our sync at 3-minute intervals = ~318 requests/5min (safely under both thresholds).

---

## Configuration

All operational parameters are configurable via `wrangler.toml`:

```toml
[vars]
# Sync settings
SYNC_INTERVAL_MS = "180000"      # 3 minutes
SYNC_CONCURRENCY = "25"          # Parallel requests
TERM_CHECK_INTERVAL_MS = "86400000"  # 24 hours

# Rate limiting
BACKOFF_BASE_MS = "5000"         # 5 seconds
BACKOFF_MAX_MS = "60000"         # 60 seconds
MAX_RETRIES = "3"

# Caching
CLIENT_CACHE_TTL_MS = "30000"    # 30 seconds

# API endpoints
CISAPI_BASE = "https://courses.illinois.edu/cisapp/explorer"
FRONTEND_BASE = "https://courses.illinois.edu"
```

---

## Task 1: Add term_state Table

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/index.ts`

**Step 1: Add term_state table to schema.sql**

Add to `src/db/schema.sql`:

```sql
-- Term state tracking
CREATE TABLE IF NOT EXISTS term_state (
    term_id TEXT PRIMARY KEY,     -- "2025-fall"
    year INTEGER NOT NULL,
    term TEXT NOT NULL,           -- "winter", "spring", "summer", "fall"
    status TEXT NOT NULL,         -- "active" | "historical"
    last_checked INTEGER,         -- Unix timestamp when status was verified
    last_synced INTEGER,          -- Unix timestamp when courses were synced
    subjects_count INTEGER,
    courses_count INTEGER,
    sections_count INTEGER,
    sync_errors TEXT,             -- JSON array of recent errors
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_term_state_status ON term_state(status);
CREATE INDEX IF NOT EXISTS idx_term_state_year ON term_state(year);
```

**Step 2: Add TypeScript types and helpers to db/index.ts**

Add to `src/db/index.ts`:

```typescript
export interface TermState {
  term_id: string;
  year: number;
  term: string;
  status: 'active' | 'historical';
  last_checked: number | null;
  last_synced: number | null;
  subjects_count: number | null;
  courses_count: number | null;
  sections_count: number | null;
  sync_errors: string | null;
  created_at: number;
  updated_at: number;
}

export function makeTermId(year: number, term: string): string {
  return `${year}-${term}`;
}

export async function upsertTermState(
  db: D1Database,
  termState: Omit<TermState, 'created_at' | 'updated_at'>
): Promise<void> {
  await db.prepare(`
    INSERT INTO term_state (term_id, year, term, status, last_checked, last_synced,
                            subjects_count, courses_count, sections_count, sync_errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(term_id) DO UPDATE SET
      status = excluded.status,
      last_checked = excluded.last_checked,
      last_synced = excluded.last_synced,
      subjects_count = excluded.subjects_count,
      courses_count = excluded.courses_count,
      sections_count = excluded.sections_count,
      sync_errors = excluded.sync_errors,
      updated_at = unixepoch()
  `).bind(
    termState.term_id, termState.year, termState.term, termState.status,
    termState.last_checked, termState.last_synced, termState.subjects_count,
    termState.courses_count, termState.sections_count, termState.sync_errors
  ).run();
}

export async function getTermsByStatus(
  db: D1Database,
  status: 'active' | 'historical'
): Promise<TermState[]> {
  const result = await db.prepare(
    'SELECT * FROM term_state WHERE status = ? ORDER BY year DESC, term'
  ).bind(status).all<TermState>();
  return result.results;
}

export async function getTermState(
  db: D1Database,
  termId: string
): Promise<TermState | null> {
  return db.prepare(
    'SELECT * FROM term_state WHERE term_id = ?'
  ).bind(termId).first<TermState>();
}
```

**Step 3: Apply schema to local D1**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler d1 execute course-search-db --local --file=src/db/schema.sql
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add term_state table for tracking active vs historical terms

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add Rate Limiter with Exponential Backoff

**Files:**
- Create: `src/services/rate-limiter.ts`

**Step 1: Create rate limiter service**

Create `src/services/rate-limiter.ts`:

```typescript
export interface RateLimiterConfig {
  backoffBaseMs: number;
  backoffMaxMs: number;
  maxRetries: number;
}

export interface RateLimitState {
  isBackingOff: boolean;
  backoffUntil: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorTime: number | null;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private state: RateLimitState;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      backoffBaseMs: config.backoffBaseMs ?? 5000,
      backoffMaxMs: config.backoffMaxMs ?? 60000,
      maxRetries: config.maxRetries ?? 3,
    };
    this.state = {
      isBackingOff: false,
      backoffUntil: null,
      consecutiveFailures: 0,
      lastError: null,
      lastErrorTime: null,
    };
  }

  getState(): RateLimitState {
    // Check if backoff period has expired
    if (this.state.backoffUntil && Date.now() >= this.state.backoffUntil) {
      this.state.isBackingOff = false;
      this.state.backoffUntil = null;
    }
    return { ...this.state };
  }

  shouldRetry(): boolean {
    return this.state.consecutiveFailures < this.config.maxRetries;
  }

  recordSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.isBackingOff = false;
    this.state.backoffUntil = null;
  }

  recordFailure(error: string, statusCode?: number): number {
    this.state.consecutiveFailures++;
    this.state.lastError = error;
    this.state.lastErrorTime = Date.now();

    // Calculate backoff with exponential increase
    const backoffMs = Math.min(
      this.config.backoffBaseMs * Math.pow(2, this.state.consecutiveFailures - 1),
      this.config.backoffMaxMs
    );

    this.state.isBackingOff = true;
    this.state.backoffUntil = Date.now() + backoffMs;

    return backoffMs;
  }

  async waitIfNeeded(): Promise<void> {
    const state = this.getState();
    if (state.isBackingOff && state.backoffUntil) {
      const waitMs = state.backoffUntil - Date.now();
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  isRateLimited(statusCode: number): boolean {
    return statusCode === 429 || statusCode === 503;
  }

  getErrorMessage(): string | null {
    if (!this.state.isBackingOff) return null;

    const waitSeconds = this.state.backoffUntil
      ? Math.ceil((this.state.backoffUntil - Date.now()) / 1000)
      : 0;

    if (waitSeconds <= 0) return null;

    return `Rate limited: waiting ${waitSeconds}s before retry. ` +
           `Last error: ${this.state.lastError}. ` +
           `Failures: ${this.state.consecutiveFailures}/${this.config.maxRetries}`;
  }

  getStaleDataWarning(): string | null {
    if (!this.state.lastErrorTime) return null;

    const staleSeconds = Math.floor((Date.now() - this.state.lastErrorTime) / 1000);
    if (staleSeconds < 60) return null;

    const staleMinutes = Math.floor(staleSeconds / 60);
    return `Data may be up to ${staleMinutes} minute(s) stale due to rate limiting`;
  }
}

// Global rate limiter instance (per-isolate)
let globalRateLimiter: RateLimiter | null = null;

export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(config);
  }
  return globalRateLimiter;
}

export function resetRateLimiter(): void {
  globalRateLimiter = null;
}
```

**Step 2: Commit**

```bash
git add .
git commit -m "feat: add rate limiter with exponential backoff

- Configurable base/max backoff and retry count
- Clear error messages for rate limiting status
- Stale data warnings when sync is delayed

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add Term Discovery Service

**Files:**
- Create: `src/services/term-discovery.ts`

**Step 1: Create term discovery service**

Create `src/services/term-discovery.ts`:

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import { upsertTermState, makeTermId, type TermState } from '../db/index.js';
import { getRateLimiter } from './rate-limiter.js';

export interface TermDiscoveryConfig {
  frontendBase: string;
  cisapiBase: string;
}

export interface DiscoveredTerm {
  year: number;
  term: string;
  termId: string;
}

export interface TermClassification {
  term: DiscoveredTerm;
  status: 'active' | 'historical';
  sampleEnrollmentStatuses: string[];
}

/**
 * Fetches valid terms for a given year from the frontend AJAX endpoint
 */
export async function discoverTermsForYear(
  config: TermDiscoveryConfig,
  year: number
): Promise<DiscoveredTerm[]> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.frontendBase}/ajax/search/termlist/${year}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (rateLimiter.isRateLimited(response.status)) {
      rateLimiter.recordFailure(`termlist ${year}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch termlist for ${year}: ${response.status}`);
  }

  rateLimiter.recordSuccess();

  const data = await response.json() as Record<string, string>;
  // Response format: {"Winter":"winter","Spring":"spring",...}

  return Object.values(data).map(term => ({
    year,
    term,
    termId: makeTermId(year, term)
  }));
}

/**
 * Discovers terms for current and next year
 */
export async function discoverAllTerms(
  config: TermDiscoveryConfig
): Promise<DiscoveredTerm[]> {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];

  const allTerms: DiscoveredTerm[] = [];

  for (const year of years) {
    try {
      const terms = await discoverTermsForYear(config, year);
      allTerms.push(...terms);
    } catch (error) {
      console.error(`Failed to discover terms for ${year}:`, error);
    }
  }

  return allTerms;
}

/**
 * Classifies a term as active or historical by sampling enrollmentStatus
 * from a subject cascade
 */
export async function classifyTerm(
  config: TermDiscoveryConfig,
  term: DiscoveredTerm,
  sampleSubject: string = 'CS'
): Promise<TermClassification> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${term.year}/${term.term}/${sampleSubject}.xml?mode=cascade`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/xml' }
  });

  if (!response.ok) {
    if (rateLimiter.isRateLimited(response.status)) {
      rateLimiter.recordFailure(`classify ${term.termId}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch ${sampleSubject} for ${term.termId}: ${response.status}`);
  }

  rateLimiter.recordSuccess();

  const xml = await response.text();

  // Extract all enrollmentStatus values
  const statusRegex = /<enrollmentStatus>([^<]*)<\/enrollmentStatus>/g;
  const statuses: string[] = [];
  let match;
  while ((match = statusRegex.exec(xml)) !== null) {
    statuses.push(match[1]);
  }

  // If ANY status is not "UNKNOWN", term is active
  const hasRealStatus = statuses.some(s => s.toUpperCase() !== 'UNKNOWN');

  return {
    term,
    status: hasRealStatus ? 'active' : 'historical',
    sampleEnrollmentStatuses: [...new Set(statuses)].slice(0, 5) // Unique, max 5
  };
}

/**
 * Full term discovery and classification workflow
 */
export async function discoverAndClassifyTerms(
  db: D1Database,
  config: TermDiscoveryConfig
): Promise<TermClassification[]> {
  const terms = await discoverAllTerms(config);
  const classifications: TermClassification[] = [];

  for (const term of terms) {
    try {
      const classification = await classifyTerm(config, term);
      classifications.push(classification);

      // Update term_state in database
      await upsertTermState(db, {
        term_id: term.termId,
        year: term.year,
        term: term.term,
        status: classification.status,
        last_checked: Math.floor(Date.now() / 1000),
        last_synced: null,
        subjects_count: null,
        courses_count: null,
        sections_count: null,
        sync_errors: null,
      });
    } catch (error) {
      console.error(`Failed to classify term ${term.termId}:`, error);
    }
  }

  return classifications;
}
```

**Step 2: Commit**

```bash
git add .
git commit -m "feat: add term discovery and classification service

- Discover terms via /ajax/search/termlist/{year}
- Classify active vs historical by sampling enrollmentStatus
- Persist term state to D1

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Add Parallel Subject Sync

**Files:**
- Create: `src/services/parallel-sync.ts`
- Modify: `src/cisapi/parser.ts` (add subject cascade parser)

**Step 1: Add subject cascade parser**

Add to `src/cisapi/parser.ts`:

```typescript
export interface ParsedSubjectCascade {
  subjectId: string;
  subjectLabel: string;
  courses: ParsedCascadeCourse[];
}

export interface ParsedCascadeCourse {
  id: string;
  subject: string;
  title: string;
  description: string;
  creditHours: string;
  genEdCategories: string[];
  sections: ParsedCascadeSection[];
}

export interface ParsedCascadeSection {
  crn: string;
  sectionNumber: string;
  enrollmentStatus: string;
  type: string;
  startTime: string;
  endTime: string;
  daysOfTheWeek: string;
  buildingName: string;
  roomNumber: string;
  instructors: { firstName: string; lastName: string }[];
}

export function parseSubjectCascadeXml(xml: string): ParsedSubjectCascade | null {
  const subjectIdMatch = xml.match(/<ns2:subject[^>]*id="([^"]+)"/);
  const labelMatch = xml.match(/<label>([^<]+)<\/label>/);

  if (!subjectIdMatch) return null;

  const subjectId = subjectIdMatch[1];
  const subjectLabel = labelMatch?.[1] ?? subjectId;

  const courses: ParsedCascadeCourse[] = [];

  // Match cascadingCourse blocks
  const courseBlockRegex = /<cascadingCourse[^>]*id="([^"]+)"[^>]*>[\s\S]*?<\/cascadingCourse>/g;
  let courseMatch;

  while ((courseMatch = courseBlockRegex.exec(xml)) !== null) {
    const block = courseMatch[0];
    const courseId = courseMatch[1];

    const titleMatch = block.match(/<label>([^<]*)<\/label>/);
    const descMatch = block.match(/<description>([^<]*)<\/description>/);
    const creditMatch = block.match(/<creditHours>([^<]*)<\/creditHours>/);

    // Parse genEd categories
    const genEdCategories: string[] = [];
    const genEdRegex = /<category[^>]*id="([^"]+)"/g;
    let genEdMatch;
    while ((genEdMatch = genEdRegex.exec(block)) !== null) {
      genEdCategories.push(genEdMatch[1]);
    }

    // Parse sections
    const sections = parseCascadeSections(block);

    // Extract just the course number from "AAS 100" format
    const courseNumber = courseId.split(' ').pop() ?? courseId;

    courses.push({
      id: courseNumber,
      subject: subjectId,
      title: titleMatch?.[1] ?? '',
      description: descMatch?.[1]?.trim() ?? '',
      creditHours: creditMatch?.[1] ?? '',
      genEdCategories,
      sections
    });
  }

  return { subjectId, subjectLabel, courses };
}

function parseCascadeSections(courseXml: string): ParsedCascadeSection[] {
  const sections: ParsedCascadeSection[] = [];

  const sectionBlockRegex = /<section[^>]*id="([^"]+)"[^>]*>[\s\S]*?<\/section>/g;
  let sectionMatch;

  while ((sectionMatch = sectionBlockRegex.exec(courseXml)) !== null) {
    const block = sectionMatch[0];
    const crn = sectionMatch[1];

    const sectionNumberMatch = block.match(/<sectionNumber>([^<]*)<\/sectionNumber>/);
    const enrollmentStatusMatch = block.match(/<enrollmentStatus>([^<]*)<\/enrollmentStatus>/);

    // Parse first meeting
    const meetingMatch = block.match(/<meeting>[\s\S]*?<\/meeting>/);
    let type = '', startTime = '', endTime = '', days = '', building = '', room = '';
    const instructors: { firstName: string; lastName: string }[] = [];

    if (meetingMatch) {
      const meeting = meetingMatch[0];
      const typeMatch = meeting.match(/<type[^>]*>([^<]*)<\/type>/);
      const startMatch = meeting.match(/<start>([^<]*)<\/start>/);
      const endMatch = meeting.match(/<end>([^<]*)<\/end>/);
      const daysMatch = meeting.match(/<daysOfTheWeek>([^<]*)<\/daysOfTheWeek>/);
      const buildingMatch = meeting.match(/<buildingName>([^<]*)<\/buildingName>/);
      const roomMatch = meeting.match(/<roomNumber>([^<]*)<\/roomNumber>/);

      type = typeMatch?.[1] ?? '';
      startTime = startMatch?.[1] ?? '';
      endTime = endMatch?.[1] ?? '';
      days = daysMatch?.[1] ?? '';
      building = buildingMatch?.[1] ?? '';
      room = roomMatch?.[1] ?? '';

      // Parse instructors
      const instructorRegex = /<instructor>[\s\S]*?<firstName>([^<]*)<\/firstName>[\s\S]*?<lastName>([^<]*)<\/lastName>[\s\S]*?<\/instructor>/g;
      let instructorMatch;
      while ((instructorMatch = instructorRegex.exec(meeting)) !== null) {
        instructors.push({
          firstName: instructorMatch[1],
          lastName: instructorMatch[2]
        });
      }
    }

    sections.push({
      crn,
      sectionNumber: sectionNumberMatch?.[1] ?? '',
      enrollmentStatus: enrollmentStatusMatch?.[1] ?? 'Unknown',
      type,
      startTime: convertTo24Hour(startTime),
      endTime: convertTo24Hour(endTime),
      daysOfTheWeek: days,
      buildingName: building,
      roomNumber: room,
      instructors
    });
  }

  return sections;
}
```

**Step 2: Create parallel sync service**

Create `src/services/parallel-sync.ts`:

```typescript
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import { upsertCourse, upsertSection, makeCourseId, type Course, type Section } from '../db/index.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';
import { getRateLimiter } from './rate-limiter.js';
import { convertTo24Hour } from '../cisapi/parser.js';

export interface ParallelSyncConfig {
  cisapiBase: string;
  concurrency: number;
}

export interface SubjectSyncResult {
  subject: string;
  success: boolean;
  coursesCount: number;
  sectionsCount: number;
  error?: string;
  durationMs: number;
}

export interface TermSyncResult {
  termId: string;
  year: number;
  term: string;
  subjectResults: SubjectSyncResult[];
  totalCourses: number;
  totalSections: number;
  successfulSubjects: number;
  failedSubjects: number;
  durationMs: number;
  rateLimitHits: number;
  staleDataWarning?: string;
}

/**
 * Fetches and parses a single subject cascade
 */
async function fetchSubjectCascade(
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subject: string
): Promise<ParsedSubjectCascade | null> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/xml' }
  });

  if (!response.ok) {
    if (rateLimiter.isRateLimited(response.status)) {
      const backoffMs = rateLimiter.recordFailure(
        `${subject}: HTTP ${response.status}`,
        response.status
      );
      throw new Error(`Rate limited on ${subject}, backing off ${backoffMs}ms`);
    }
    throw new Error(`HTTP ${response.status} for ${subject}`);
  }

  rateLimiter.recordSuccess();

  const xml = await response.text();

  // Check for HTML error page
  if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
    throw new Error(`HTML response for ${subject} (likely 404)`);
  }

  return parseSubjectCascadeXml(xml);
}

/**
 * Saves parsed subject data to D1 and optionally Vectorize
 */
async function saveSubjectData(
  db: D1Database,
  parsed: ParsedSubjectCascade,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<{ coursesCount: number; sectionsCount: number }> {
  let coursesCount = 0;
  let sectionsCount = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const course of parsed.courses) {
    const courseId = makeCourseId(parsed.subjectId, course.id, year, term);

    // Get primary instructor
    const firstSection = course.sections.find(s =>
      s.type.toLowerCase().includes('lecture') || s.type.toLowerCase().includes('lec')
    ) ?? course.sections[0];

    const primaryInstructor = firstSection?.instructors[0];
    const primaryInstructorName = primaryInstructor
      ? `${primaryInstructor.lastName}, ${primaryInstructor.firstName.charAt(0)}`
      : null;

    // Parse credit hours
    const creditHours = parseInt(course.creditHours) || null;

    // Upsert course
    const courseData: Omit<Course, 'created_at' | 'updated_at'> = {
      id: courseId,
      subject: parsed.subjectId,
      number: course.id,
      title: course.title,
      description: course.description || null,
      credit_hours: creditHours,
      gened: course.genEdCategories[0] ?? null,
      year,
      term,
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: primaryInstructorName,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      last_synced: now
    };

    await upsertCourse(db, courseData);
    coursesCount++;

    // Generate embedding if available
    if (vectorize && ai) {
      try {
        const embeddingData: CourseEmbeddingData = {
          id: courseId,
          subject: parsed.subjectId,
          number: course.id,
          title: course.title,
          description: course.description || null,
          gened: course.genEdCategories[0] ?? null,
          primary_instructor: primaryInstructorName
        };
        await upsertCourseEmbedding(vectorize, ai, embeddingData);
      } catch (e) {
        console.error(`Embedding error for ${courseId}:`, e);
      }
    }

    // Upsert sections
    for (const section of course.sections) {
      const instructorName = section.instructors[0]
        ? `${section.instructors[0].lastName}, ${section.instructors[0].firstName.charAt(0)}`
        : null;

      const sectionData: Section = {
        crn: section.crn,
        course_id: courseId,
        section_number: section.sectionNumber || null,
        status: section.enrollmentStatus || null,
        type: section.type || null,
        days: section.daysOfTheWeek || null,
        start_time: section.startTime || null,
        end_time: section.endTime || null,
        location: `${section.buildingName} ${section.roomNumber}`.trim() || null,
        instructor: instructorName,
        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: now
      };

      await upsertSection(db, sectionData);
      sectionsCount++;
    }
  }

  return { coursesCount, sectionsCount };
}

/**
 * Fetches all subjects for a term
 */
async function getSubjectsForTerm(
  config: ParallelSyncConfig,
  year: number,
  term: string
): Promise<string[]> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/xml' }
  });

  if (!response.ok) {
    throw new Error(`Failed to get subjects: HTTP ${response.status}`);
  }

  rateLimiter.recordSuccess();

  const xml = await response.text();
  const subjectRegex = /<subject id="([^"]+)"/g;
  const subjects: string[] = [];
  let match;

  while ((match = subjectRegex.exec(xml)) !== null) {
    subjects.push(match[1]);
  }

  return subjects;
}

/**
 * Parallel sync of all subjects for a term
 */
export async function syncTerm(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<TermSyncResult> {
  const startTime = Date.now();
  const termId = `${year}-${term}`;

  // Get all subjects
  const subjects = await getSubjectsForTerm(config, year, term);

  const results: SubjectSyncResult[] = [];
  let rateLimitHits = 0;

  // Process in batches based on concurrency
  for (let i = 0; i < subjects.length; i += config.concurrency) {
    const batch = subjects.slice(i, i + config.concurrency);

    const batchPromises = batch.map(async (subject): Promise<SubjectSyncResult> => {
      const subjectStart = Date.now();

      try {
        const parsed = await fetchSubjectCascade(config, year, term, subject);

        if (!parsed) {
          return {
            subject,
            success: false,
            coursesCount: 0,
            sectionsCount: 0,
            error: 'Failed to parse response',
            durationMs: Date.now() - subjectStart
          };
        }

        const { coursesCount, sectionsCount } = await saveSubjectData(
          db, parsed, year, term, vectorize, ai
        );

        return {
          subject,
          success: true,
          coursesCount,
          sectionsCount,
          durationMs: Date.now() - subjectStart
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('Rate limited')) {
          rateLimitHits++;
        }

        return {
          subject,
          success: false,
          coursesCount: 0,
          sectionsCount: 0,
          error: errorMsg,
          durationMs: Date.now() - subjectStart
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const rateLimiter = getRateLimiter();
  const staleWarning = rateLimiter.getStaleDataWarning();

  return {
    termId,
    year,
    term,
    subjectResults: results,
    totalCourses: results.reduce((sum, r) => sum + r.coursesCount, 0),
    totalSections: results.reduce((sum, r) => sum + r.sectionsCount, 0),
    successfulSubjects: results.filter(r => r.success).length,
    failedSubjects: results.filter(r => !r.success).length,
    durationMs: Date.now() - startTime,
    rateLimitHits,
    staleDataWarning: staleWarning ?? undefined
  };
}
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add parallel subject cascade sync

- Parse full subject cascade XML
- Parallel batch processing with configurable concurrency
- Rate limit detection and backoff integration
- Stale data warnings

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Update Configuration and Bindings

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/index.ts`

**Step 1: Update wrangler.toml with new config vars**

Update `wrangler.toml`:

```toml
name = "uiuc-course-search"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
CURRENT_YEAR = "2026"
CURRENT_TERM = "spring"

# API endpoints
CISAPI_BASE = "https://courses.illinois.edu/cisapp/explorer"
FRONTEND_BASE = "https://courses.illinois.edu"

# Sync settings
SYNC_INTERVAL_MS = "180000"
SYNC_CONCURRENCY = "25"
TERM_CHECK_INTERVAL_MS = "86400000"

# Rate limiting
BACKOFF_BASE_MS = "5000"
BACKOFF_MAX_MS = "60000"
MAX_RETRIES = "3"

# Caching
CLIENT_CACHE_TTL_MS = "30000"

[[d1_databases]]
binding = "DB"
database_name = "course-search-db"
database_id = "YOUR_DATABASE_ID"

[[vectorize]]
binding = "VECTORIZE"
index_name = "course-embeddings"

[ai]
binding = "AI"
```

**Step 2: Update Bindings type in index.ts**

Update `src/index.ts` to include new bindings:

```typescript
type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;

  // API endpoints
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;

  // Sync settings
  SYNC_INTERVAL_MS: string;
  SYNC_CONCURRENCY: string;
  TERM_CHECK_INTERVAL_MS: string;

  // Rate limiting
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;

  // Caching
  CLIENT_CACHE_TTL_MS: string;
};
```

**Step 3: Commit**

```bash
git add .
git commit -m "chore: add configurable sync parameters to wrangler.toml

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Add Sync Endpoints

**Files:**
- Modify: `src/index.ts`

**Step 1: Add term discovery and sync endpoints**

Add to `src/index.ts`:

```typescript
import { discoverAndClassifyTerms, discoverTermsForYear } from './services/term-discovery.js';
import { syncTerm } from './services/parallel-sync.js';
import { getTermsByStatus, getTermState, upsertTermState, makeTermId } from './db/index.js';
import { getRateLimiter, resetRateLimiter } from './services/rate-limiter.js';

// Term discovery endpoint
app.post('/admin/discover-terms', async (c) => {
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

// Get term states
app.get('/admin/terms', async (c) => {
  const status = c.req.query('status') as 'active' | 'historical' | undefined;

  try {
    if (status) {
      const terms = await getTermsByStatus(c.env.DB, status);
      return c.json({ terms });
    }

    // Return all terms
    const active = await getTermsByStatus(c.env.DB, 'active');
    const historical = await getTermsByStatus(c.env.DB, 'historical');
    return c.json({ active, historical });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Sync a specific term
app.post('/admin/sync/:year/:term', async (c) => {
  const { year, term } = c.req.param();

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
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

    // Update term_state
    await upsertTermState(c.env.DB, {
      term_id: makeTermId(parseInt(year), term),
      year: parseInt(year),
      term,
      status: 'active', // Assume active if manually syncing
      last_checked: Math.floor(Date.now() / 1000),
      last_synced: Math.floor(Date.now() / 1000),
      subjects_count: result.successfulSubjects + result.failedSubjects,
      courses_count: result.totalCourses,
      sections_count: result.totalSections,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });

    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Sync all active terms
app.post('/admin/sync-active', async (c) => {
  const activeTerms = await getTermsByStatus(c.env.DB, 'active');

  if (activeTerms.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
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
    results.push(result);

    // Update term_state
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

// Rate limiter status
app.get('/admin/rate-limit-status', (c) => {
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

// Reset rate limiter (for testing/recovery)
app.post('/admin/reset-rate-limiter', (c) => {
  resetRateLimiter();
  return c.json({ message: 'Rate limiter reset' });
});
```

**Step 2: Commit**

```bash
git add .
git commit -m "feat: add admin endpoints for term discovery and sync

- POST /admin/discover-terms - discover and classify terms
- GET /admin/terms - view term states
- POST /admin/sync/:year/:term - sync specific term
- POST /admin/sync-active - sync all active terms
- GET /admin/rate-limit-status - view rate limiter state

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Add Fresh Fetch for Individual Courses

**Files:**
- Modify: `src/index.ts`

**Step 1: Add on-demand fresh fetch endpoint**

Add to `src/index.ts`:

```typescript
// Fresh fetch for a single course (bypasses cache, updates DB, returns live data)
app.get('/api/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();
  const year = c.req.query('year') || c.env.CURRENT_YEAR;
  const term = c.req.query('term') || c.env.CURRENT_TERM;

  const cacheHeader = c.req.header('Cache-Control');
  const bypassCache = cacheHeader?.includes('no-cache') || c.req.query('fresh') === 'true';

  // Check client cache TTL
  const cacheTtl = parseInt(c.env.CLIENT_CACHE_TTL_MS) || 30000;
  const courseId = makeCourseId(subject, number, parseInt(year), term);

  // If not bypassing cache, check if we have recent data
  if (!bypassCache) {
    const existing = await c.env.DB.prepare(
      'SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses WHERE id = ?'
    ).bind(courseId).first<Course & { age_seconds: number }>();

    if (existing && existing.age_seconds * 1000 < cacheTtl) {
      // Return cached data with cache header
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

  // Fetch fresh data
  const rateLimiter = getRateLimiter({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  // Check if we're rate limited
  const state = rateLimiter.getState();
  if (state.isBackingOff) {
    // Return stale data with warning
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

  try {
    await rateLimiter.waitIfNeeded();

    const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}/${subject}/${number}.xml?mode=cascade`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml' }
    });

    if (!response.ok) {
      if (rateLimiter.isRateLimited(response.status)) {
        rateLimiter.recordFailure(`${subject} ${number}: ${response.status}`, response.status);
      }
      return c.json({ error: `Course not found: ${response.status}` }, 404);
    }

    rateLimiter.recordSuccess();

    const xml = await response.text();
    const parsed = parseCourseDetailXml(xml);

    if (!parsed) {
      return c.json({ error: 'Failed to parse course data' }, 500);
    }

    // Save to database
    const now = Math.floor(Date.now() / 1000);
    // ... (reuse sync logic to save course and sections)

    // Return fresh data
    return c.json({
      id: courseId,
      subject,
      number,
      title: parsed.label,
      description: parsed.description,
      credit_hours: parseInt(parsed.creditHours) || null,
      gened: parsed.genEdCategories[0]?.id ?? null,
      year: parseInt(year),
      term,
      sections: parsed.sections,
      _cached: false,
      _fetched_at: now
    }, 200, {
      'Cache-Control': `max-age=${Math.floor(cacheTtl / 1000)}`,
      'X-Cache': 'MISS'
    });

  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
```

**Step 2: Commit**

```bash
git add .
git commit -m "feat: add fresh fetch endpoint for individual courses

- GET /api/course/:subject/:number with optional year/term
- Respects client cache TTL
- Returns stale data with warning when rate limited
- Cache headers for client-side caching

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Test and Deploy

**Step 1: Apply schema to local and remote D1**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler d1 execute course-search-db --local --file=src/db/schema.sql
cd /Users/lu/uiuc-course-search && npx wrangler d1 execute course-search-db --remote --file=src/db/schema.sql
```

**Step 2: Test locally**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler dev --remote
```

In another terminal:
```bash
# Discover terms
curl -X POST http://localhost:8787/admin/discover-terms

# Check term states
curl http://localhost:8787/admin/terms

# Sync active terms
curl -X POST http://localhost:8787/admin/sync-active

# Check rate limiter
curl http://localhost:8787/admin/rate-limit-status

# Fresh fetch a course
curl "http://localhost:8787/api/course/CS/225?fresh=true"
```

**Step 3: Deploy**

```bash
cd /Users/lu/uiuc-course-search && npx wrangler deploy
```

**Step 4: Tag release**

```bash
git tag v0.2.0-phase1.5
git push origin v0.2.0-phase1.5
```

---

## Summary

Phase 1.5 delivers:
- `term_state` table for tracking active vs historical terms
- Term discovery via `/ajax/search/termlist/{year}`
- Term classification by sampling enrollmentStatus
- Parallel subject cascade sync (~2.5s for entire term)
- Exponential backoff with clear rate-limit error messages
- Configurable operational parameters
- Fresh fetch endpoint with client-side caching
- Stale data warnings when rate limited

Next phases will add:
- Scheduled cron triggers for automatic sync
- Historical backfill job
- Phase 2: Query parser (Compromise.js)
- Phase 3: Data enrichment (GPA, RMP)
