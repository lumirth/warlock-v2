#!/usr/bin/env npx tsx
/**
 * Historical Sync Script
 *
 * Fetches all historical course data from CISAPI and writes SQL inserts
 * that can be executed against D1.
 *
 * Usage:
 *   npx tsx scripts/historical-sync.ts
 *   wrangler d1 execute course-search-db --remote --file=historical-data-YYYY-MM-DDTHH-MM-SS.sql
 *
 * Options:
 *   --start-year=YYYY  Start year (default: 2004)
 *   --end-year=YYYY    End year (default: current year)
 *   --term=TERM        Only sync specific term (e.g., spring, fall)
 *   --sql-file=PATH    SQL output file (default: timestamped)
 *   --log-file=PATH    Log output file (default: timestamped)
 *   --dry-run          Don't output SQL, just show what would be synced
 *   --fresh            Ignore checkpoint, start fresh
 *
 * Output:
 *   - SQL is written to a timestamped .sql file in the current directory
 *   - Logs are written to a timestamped .log file in the current directory
 *   - Progress is also displayed in the terminal
 *
 * Resume:
 *   The script saves progress to historical-sync-checkpoint.json after each batch.
 *   If interrupted, simply re-run the same command to resume where you left off.
 *   Use --fresh to ignore the checkpoint and start over.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { parseSubjectCascadeXmlFromString, type ParsedSubjectCascade } from '../apps/api/src/cisapi/parser.ts';

// Inline makeCourseId to avoid D1 type issues
export function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

function makeTermId(year: number, term: string): string {
  return `${year}-${term}`;
}

function makeSectionId(termId: string, crn: string): string {
  return `${termId}-${crn}`;
}

// Format instructor name as "LastName, F" or just "LastName" if no first name
function formatInstructorName(inst: { firstName: string; lastName: string }): string {
  if (inst.firstName) {
    return `${inst.lastName}, ${inst.firstName.charAt(0)}`;
  }
  return inst.lastName;
}

// Transform types for SQL generation
interface SubjectData {
  id: string;
  name: string;
  college_code: string | null;
  department_code: string | null;
  unit_name: string | null;
  contact_name: string | null;
  contact_title: string | null;
  address_line1: string | null;
  address_line2: string | null;
  phone_number: string | null;
  website_url: string | null;
  description: string | null;
}

interface CourseData {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  credit_hours: number | null;
  gened: string | null;
  subject_id: string | null;
  course_info: string | null;
  degree_attributes: string | null;
  class_schedule_info: string | null;
  date_range_text: string | null;
  registration_notes: string | null;
  approval_code: string | null;
  year: number;
  term: string;
  primary_instructor: string | null;
}

interface SectionData {
  id: string;
  crn: string;
  course_id: string;
  term_id: string;
  section_number: string | null;
  status: string | null;
  type: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  instructor: string | null;
  section_title: string | null;
  status_code: string | null;
  section_status_code: string | null;
  section_text: string | null;
  section_notes: string | null;
  capp_area: string | null;
  date_range_text: string | null;
  part_of_term: string | null;
  start_date: string | null;
  end_date: string | null;
  credit_hours: string | null;
}

interface MeetingData {
  section_id: string;
  meeting_index: number;
  type_code: string | null;
  type_name: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  building_name: string | null;
  room_number: string | null;
  date_range_text: string | null;
  instructors: { firstName: string; lastName: string }[];
}

interface GenEdData {
  categoryId: string;
  categoryName: string | null;
  attributeCode: string | null;
  attributeName: string | null;
}

interface TransformedCourse {
  course: CourseData;
  sections: { section: SectionData; meetings: MeetingData[] }[];
  genEdCategories: GenEdData[];
}

interface TransformResult {
  subject: SubjectData;
  coursesWithSections: TransformedCourse[];
}

// Transform parsed XML into our database format
function fromSubjectCascade(parsed: ParsedSubjectCascade, year: number, term: string): TransformResult {
  const meta = parsed.subjectMetadata;
  const termId = makeTermId(year, term);

  const subject: SubjectData = {
    id: parsed.subjectId,
    name: parsed.subjectLabel || meta.label || parsed.subjectId,
    college_code: meta.collegeCode || null,
    department_code: meta.departmentCode || null,
    unit_name: meta.unitName || null,
    contact_name: meta.contactName || null,
    contact_title: meta.contactTitle || null,
    address_line1: meta.addressLine1 || null,
    address_line2: meta.addressLine2 || null,
    phone_number: meta.phoneNumber || null,
    website_url: meta.websiteUrl || null,
    description: meta.description || null,
  };

  const coursesWithSections: TransformedCourse[] = parsed.courses.map(course => {
    const courseId = makeCourseId(parsed.subjectId, course.id, year, term);

    // Get primary instructor from first lecture section
    const lectureSection = course.sections.find(s =>
      s.meetings.some(m => m.typeName.toLowerCase().includes('lecture'))
    ) || course.sections[0];

    const firstMeeting = lectureSection?.meetings[0];
    const primaryInstructor = firstMeeting?.instructors[0];
    const primaryInstructorName = primaryInstructor ? formatInstructorName(primaryInstructor) : null;

    // Parse credit hours
    const creditHours = parseInt(course.creditHours) || null;

    // First gened category ID for the simple gened field
    const firstGenEd = course.genEdCategories[0]?.id || null;

    const courseData: CourseData = {
      id: courseId,
      subject: parsed.subjectId,
      number: course.id,
      title: course.title,
      description: course.description || null,
      credit_hours: creditHours,
      gened: firstGenEd,
      subject_id: parsed.subjectId,
      course_info: course.courseInfo || null,
      degree_attributes: course.degreeAttributes || null,
      class_schedule_info: course.classScheduleInfo || null,
      date_range_text: course.dateRangeText || null,
      registration_notes: course.registrationNotes || null,
      approval_code: course.approvalCode || null,
      year,
      term,
      primary_instructor: primaryInstructorName,
    };

    // Transform genEd categories
    const genEdCategories: GenEdData[] = [];
    for (const ge of course.genEdCategories) {
      if (ge.attributes.length > 0) {
        for (const attr of ge.attributes) {
          genEdCategories.push({
            categoryId: ge.id,
            categoryName: ge.name || null,
            attributeCode: attr.code || null,
            attributeName: attr.name || null,
          });
        }
      } else {
        genEdCategories.push({
          categoryId: ge.id,
          categoryName: ge.name || null,
          attributeCode: null,
          attributeName: null,
        });
      }
    }

    // Transform sections
    const sections = course.sections.map(sec => {
      const firstMeeting = sec.meetings[0];
      const firstInstructor = firstMeeting?.instructors[0];
      const instructorName = firstInstructor ? formatInstructorName(firstInstructor) : null;
      const location = firstMeeting
        ? `${firstMeeting.buildingName} ${firstMeeting.roomNumber}`.trim()
        : null;

      const sectionData: SectionData = {
        id: makeSectionId(termId, sec.crn),
        crn: sec.crn,
        course_id: courseId,
        term_id: termId,
        section_number: sec.sectionNumber || null,
        status: sec.enrollmentStatus || null,
        type: firstMeeting?.typeName || null,
        days: firstMeeting?.days || null,
        start_time: firstMeeting?.startTime || null,
        end_time: firstMeeting?.endTime || null,
        location: location || null,
        instructor: instructorName,
        section_title: sec.sectionTitle || null,
        status_code: sec.statusCode || null,
        section_status_code: sec.sectionStatusCode || null,
        section_text: sec.sectionText || null,
        section_notes: sec.sectionNotes || null,
        capp_area: sec.cappArea || null,
        date_range_text: sec.dateRangeText || null,
        part_of_term: sec.partOfTerm || null,
        start_date: sec.startDate || null,
        end_date: sec.endDate || null,
        credit_hours: sec.creditHours || null,
      };

      const meetings: MeetingData[] = sec.meetings.map((m, idx) => ({
        section_id: makeSectionId(termId, sec.crn),
        meeting_index: idx,
        type_code: m.typeCode || null,
        type_name: m.typeName || null,
        days: m.days || null,
        start_time: m.startTime || null,
        end_time: m.endTime || null,
        building_name: m.buildingName || null,
        room_number: m.roomNumber || null,
        date_range_text: m.dateRangeText || null,
        instructors: m.instructors,
      }));

      return { section: sectionData, meetings };
    });

    return { course: courseData, sections, genEdCategories };
  });

  return { subject, coursesWithSections };
}

// Configuration
const CONFIG = {
  CISAPI_BASE: 'https://courses.illinois.edu/cisapp/explorer',
  FRONTEND_BASE: 'https://courses.illinois.edu',
  // ROBUST BURST STRATEGY:
  // 1. Limit concurrent connections to avoid overwhelming network/server
  // 2. Blast up to MAX_CONCURRENT requests, queue the rest
  // 3. When rate limited, pause ALL requests, wait for window, resume
  // 4. Retry failed requests in subsequent batches
  MAX_CONCURRENT: 50,           // Max simultaneous connections
  BATCH_SIZE: 500,              // Process 500 items per batch (queued through pool)
  RATE_LIMIT_WINDOW_MS: 10 * 60 * 1000, // WAF uses 10-minute rolling window
  RATE_LIMIT_BUFFER_MS: 15 * 1000,      // Safety buffer after window expires
  NETWORK_TIMEOUT_MS: 30000,    // 30s timeout per request
  START_YEAR: 2004,
  CHECKPOINT_FILE: 'historical-sync-checkpoint.json',
} as const;

// =============================================================================
// CHECKPOINT SYSTEM - Resume interrupted syncs
// =============================================================================

interface Checkpoint {
  completedItems: string[];  // "year-term-subject" keys
  lastUpdated: string;
}

const completedSet = new Set<string>();

function makeItemKey(year: number, term: string, subject: string): string {
  return `${year}-${term}-${subject}`;
}

function loadCheckpoint(): void {
  const checkpointPath = path.join(process.cwd(), CONFIG.CHECKPOINT_FILE);
  try {
    if (fs.existsSync(checkpointPath)) {
      const data = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as Checkpoint;
      for (const key of data.completedItems) {
        completedSet.add(key);
      }
      writeLog(`[CHECKPOINT] Loaded ${completedSet.size} completed items from checkpoint`);
    }
  } catch (err) {
    writeLog(`[CHECKPOINT] Could not load checkpoint: ${err}`);
  }
}

function saveCheckpoint(): void {
  const checkpointPath = path.join(process.cwd(), CONFIG.CHECKPOINT_FILE);
  const checkpoint: Checkpoint = {
    completedItems: Array.from(completedSet),
    lastUpdated: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));
  } catch (err) {
    writeLog(`[CHECKPOINT] Could not save checkpoint: ${err}`);
  }
}

function markCompleted(year: number, term: string, subject: string): void {
  completedSet.add(makeItemKey(year, term, subject));
}

function isCompleted(year: number, term: string, subject: string): boolean {
  return completedSet.has(makeItemKey(year, term, subject));
}

function clearCheckpoint(): void {
  const checkpointPath = path.join(process.cwd(), CONFIG.CHECKPOINT_FILE);
  try {
    if (fs.existsSync(checkpointPath)) {
      fs.unlinkSync(checkpointPath);
      writeLog(`[CHECKPOINT] Cleared checkpoint file`);
    }
  } catch (err) {
    writeLog(`[CHECKPOINT] Could not clear checkpoint: ${err}`);
  }
}

// =============================================================================
// ROBUST CONNECTION POOL WITH RATE LIMIT COORDINATION
// =============================================================================

// Global state for rate limiting
let rateLimitPromise: Promise<void> | null = null;
let burstStartTime: number | null = null;

// Semaphore for limiting concurrent connections
let activeConnections = 0;
const connectionQueue: Array<() => void> = [];

async function acquireConnection(): Promise<void> {
  // If rate limited, wait for that first
  if (rateLimitPromise) {
    await rateLimitPromise;
  }

  // If under limit, proceed immediately
  if (activeConnections < CONFIG.MAX_CONCURRENT) {
    activeConnections++;
    return;
  }

  // Otherwise wait in queue
  return new Promise<void>((resolve) => {
    connectionQueue.push(() => {
      activeConnections++;
      resolve();
    });
  });
}

function releaseConnection(): void {
  activeConnections--;
  // Wake up next waiter if any
  const next = connectionQueue.shift();
  if (next) next();
}

function recordBurstStart(): void {
  if (burstStartTime === null) {
    burstStartTime = Date.now();
  }
}

function getRateLimitWaitTime(): number {
  const now = Date.now();
  if (burstStartTime === null) {
    return CONFIG.RATE_LIMIT_WINDOW_MS + CONFIG.RATE_LIMIT_BUFFER_MS;
  }
  const windowExpires = burstStartTime + CONFIG.RATE_LIMIT_WINDOW_MS + CONFIG.RATE_LIMIT_BUFFER_MS;
  if (now >= windowExpires) {
    return CONFIG.RATE_LIMIT_BUFFER_MS;
  }
  return windowExpires - now;
}

// Called when ANY request hits 403 - pauses ALL requests
async function triggerRateLimitWait(): Promise<void> {
  if (rateLimitPromise) {
    // Already waiting, just join the existing wait
    await rateLimitPromise;
    return;
  }

  const waitTime = getRateLimitWaitTime();
  const waitMin = (waitTime / 1000 / 60).toFixed(1);
  writeLog(`\n[RATE LIMIT] Blocked - pausing all requests for ${waitMin}m...`);

  rateLimitPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      writeLog(`[RATE LIMIT] Window expired - resuming`);
      burstStartTime = null;
      rateLimitPromise = null;
      resolve();
    }, waitTime);
  });

  await rateLimitPromise;
}

// Result type for fetch operations
type FetchResult =
  | { ok: true; data: string }
  | { ok: false; error: 'rate_limited' }
  | { ok: false; error: 'network'; message: string };

// Single fetch with timeout, no retries (retries handled at batch level)
async function fetchOnce(url: string): Promise<FetchResult> {
  await acquireConnection();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.NETWORK_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.status === 403 || response.status === 429) {
        return { ok: false, error: 'rate_limited' };
      }

      if (!response.ok) {
        return { ok: false, error: 'network', message: `HTTP ${response.status}` };
      }

      const data = await response.text();
      return { ok: true, data };
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: 'network', message };
    }
  } finally {
    releaseConnection();
  }
}

// Fetch with coordinated rate limit handling
async function robustFetch(url: string): Promise<string> {
  while (true) {
    // Wait if currently rate limited
    if (rateLimitPromise) {
      await rateLimitPromise;
    }

    const result = await fetchOnce(url);

    if (result.ok) {
      return result.data;
    }

    if (result.error === 'rate_limited') {
      stats.retriedRequests++;
      await triggerRateLimitWait();
      // Loop and retry
      continue;
    }

    // Network error - throw to let caller handle
    throw new Error(result.message);
  }
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://courses.illinois.edu/',
};

// Parse command line arguments
interface Args {
  startYear: number;
  endYear: number;
  termFilter: string | null;
  dryRun: boolean;
  fresh: boolean;
  sqlFile: string;
  logFile: string;
}

// File writers for SQL and logs
let sqlWriter: fs.WriteStream | null = null;
let logWriter: fs.WriteStream | null = null;

function writeSql(line: string): void {
  if (sqlWriter) {
    sqlWriter.write(line + '\n');
  }
}

function writeLog(message: string): void {
  // Always write to terminal
  console.log(message);
  // Also write to log file
  if (logWriter) {
    logWriter.write(message + '\n');
  }
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const currentYear = new Date().getFullYear();

  let startYear: number = CONFIG.START_YEAR;
  let endYear = currentYear;
  let termFilter: string | null = null;
  let dryRun = false;
  let fresh = false;
  let sqlFile: string | null = null;
  let logFile: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--start-year=')) {
      startYear = parseInt(arg.split('=')[1], 10);
      if (isNaN(startYear)) {
        console.error(`Invalid --start-year value: ${arg}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--end-year=')) {
      endYear = parseInt(arg.split('=')[1], 10);
      if (isNaN(endYear)) {
        console.error(`Invalid --end-year value: ${arg}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--term=')) {
      termFilter = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--sql-file=')) {
      sqlFile = arg.split('=')[1];
    } else if (arg.startsWith('--log-file=')) {
      logFile = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--fresh') {
      fresh = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Historical Sync Script

Usage:
  npx tsx scripts/historical-sync.ts [options]

Options:
  --start-year=YYYY  Start year (default: ${CONFIG.START_YEAR})
  --end-year=YYYY    End year (default: ${currentYear})
  --term=TERM        Only sync specific term (e.g., spring, fall, summer, winter)
  --sql-file=PATH    SQL output file (default: historical-data.sql)
  --log-file=PATH    Log output file (default: historical-sync.log)
  --dry-run          Don't output SQL, just show what would be synced
  --fresh            Ignore checkpoint, start fresh
  --help, -h         Show this help message

Examples:
  npx tsx scripts/historical-sync.ts
  npx tsx scripts/historical-sync.ts --start-year=2020
  npx tsx scripts/historical-sync.ts --term=fall --start-year=2023
  npx tsx scripts/historical-sync.ts --dry-run
`);
      process.exit(0);
    }
  }

  if (startYear > endYear) {
    console.error(`Error: --start-year (${startYear}) cannot be greater than --end-year (${endYear})`);
    process.exit(1);
  }

  // Generate default file names based on timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (!sqlFile) {
    sqlFile = `historical-data-${timestamp}.sql`;
  }
  if (!logFile) {
    logFile = `historical-sync-${timestamp}.log`;
  }

  return { startYear, endYear, termFilter, dryRun, fresh, sqlFile, logFile };
}

// Statistics tracking
interface SyncStats {
  totalYears: number;
  totalTerms: number;
  totalSubjects: number;
  totalCourses: number;
  totalSections: number;
  failedSubjects: string[];
  retriedRequests: number;
  termStats: Map<string, { courses: number; sections: number; subjects: number }>;
}

const stats: SyncStats = {
  totalYears: 0,
  totalTerms: 0,
  totalSubjects: 0,
  totalCourses: 0,
  totalSections: 0,
  failedSubjects: [],
  retriedRequests: 0,
  termStats: new Map(),
};

async function getTerms(year: number): Promise<string[]> {
  // Try AJAX endpoint first (faster, but may be blocked)
  const ajaxUrl = `${CONFIG.FRONTEND_BASE}/ajax/search/termlist/${year}`;

  try {
    const data = await robustFetch(ajaxUrl);
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(data) as Record<string, string>;
      const terms = Object.values(parsed);
      if (terms.length > 0) return terms;
    } catch {
      // Not JSON, fall through to XML
    }
  } catch {
    // Network error, fall through to XML
  }

  // Fallback: try known term patterns via XML API
  const possibleTerms = ['winter', 'spring', 'summer', 'fall'];
  const validTerms: string[] = [];

  for (const term of possibleTerms) {
    try {
      const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}.xml`;
      const text = await robustFetch(url);
      if (text.includes('<subject') || text.includes('<ns2:')) {
        validTerms.push(term);
      }
    } catch {
      // This term doesn't exist or network error, skip
    }
  }

  return validTerms;
}

async function getSubjects(year: number, term: string): Promise<string[]> {
  const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}.xml`;
  try {
    const xml = await robustFetch(url);
    const subjects: string[] = [];
    const regex = /<subject id="([^"]+)"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      subjects.push(match[1]);
    }
    return subjects;
  } catch {
    return [];
  }
}

export function escapeSQL(str: string | null): string {
  if (str === null) return 'NULL';
  // Escape single quotes and replace newlines/carriage returns with space
  // Also handle backslashes to avoid escape sequence issues
  return `'${str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\r?\n/g, ' ')
    .replace(/\r/g, ' ')
  }'`;
}

export type HistoricalGenEdCategoryForSql = {
  categoryId: string;
  categoryName: string | null;
  attributeCode: string | null;
  attributeName: string | null;
};

export function courseGenedSqlStatements(
  courseId: string,
  genEdCategories: HistoricalGenEdCategoryForSql[],
): string[] {
  return genEdCategories.flatMap(ge => {
    const statements: string[] = [];
    if (ge.attributeCode === null) {
      statements.push(`DELETE FROM course_gened WHERE course_id = ${escapeSQL(courseId)} AND category_id = ${escapeSQL(ge.categoryId)} AND attribute_code IS NULL;`);
    }
    statements.push(`INSERT OR REPLACE INTO course_gened (course_id, category_id, category_name, attribute_code, attribute_name) VALUES (${escapeSQL(courseId)}, ${escapeSQL(ge.categoryId)}, ${escapeSQL(ge.categoryName)}, ${escapeSQL(ge.attributeCode)}, ${escapeSQL(ge.attributeName)});`);
    return statements;
  });
}

function printSummary(args: Args, startTime: Date): void {
  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMin = (durationMs / 1000 / 60).toFixed(2);

  writeLog(`\n${'='.repeat(60)}`);
  writeLog(`HISTORICAL SYNC SUMMARY`);
  writeLog(`${'='.repeat(60)}`);
  writeLog(`\nConfiguration:`);
  writeLog(`  Start Year:    ${args.startYear}`);
  writeLog(`  End Year:      ${args.endYear}`);
  writeLog(`  Term Filter:   ${args.termFilter || '(all terms)'}`);
  writeLog(`  Dry Run:       ${args.dryRun}`);

  writeLog(`\nResults:`);
  writeLog(`  Years Synced:      ${stats.totalYears}`);
  writeLog(`  Terms Synced:      ${stats.totalTerms}`);
  writeLog(`  Subjects Synced:   ${stats.totalSubjects}`);
  writeLog(`  Courses Synced:    ${stats.totalCourses}`);
  writeLog(`  Sections Synced:   ${stats.totalSections}`);
  writeLog(`  Retried Requests:  ${stats.retriedRequests}`);
  writeLog(`  Failed Subjects:   ${stats.failedSubjects.length}`);

  writeLog(`\nTiming:`);
  writeLog(`  Started:    ${startTime.toISOString()}`);
  writeLog(`  Completed:  ${endTime.toISOString()}`);
  writeLog(`  Duration:   ${durationMin} minutes`);

  if (stats.failedSubjects.length > 0) {
    writeLog(`\n[WARNING] Failed subjects (${stats.failedSubjects.length}):`);
    for (const failure of stats.failedSubjects) {
      writeLog(`  - ${failure}`);
    }
  }

  writeLog(`\nPer-Term Breakdown:`);
  for (const [termId, termStats] of stats.termStats) {
    writeLog(`  ${termId}: ${termStats.subjects} subjects, ${termStats.courses} courses, ${termStats.sections} sections`);
  }

  // Final status
  writeLog(`\n${'='.repeat(60)}`);
  if (stats.failedSubjects.length === 0) {
    writeLog(`✓ SYNC COMPLETE - All data fetched successfully`);
  } else {
    writeLog(`⚠ SYNC COMPLETE WITH ERRORS - ${stats.failedSubjects.length} subjects failed`);
    writeLog(`  Consider re-running with specific term to retry failed subjects`);
  }
  writeLog(`${'='.repeat(60)}\n`);
}

async function discoverAllTerms(startYear: number, endYear: number, termFilter: string | null): Promise<{ year: number; term: string }[]> {
  writeLog(`\n[DISCOVERY] Fetching all terms for years ${startYear}-${endYear} in parallel...`);

  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

  // Fetch all years' terms in parallel
  const yearTermsResults = await Promise.all(
    years.map(async (year) => {
      let terms = await getTerms(year);
      if (termFilter) {
        terms = terms.filter(t => t.toLowerCase() === termFilter);
      }
      return terms.map(term => ({ year, term }));
    })
  );

  // Flatten into single array of { year, term } objects
  const allTerms = yearTermsResults.flat();

  writeLog(`[DISCOVERY] Found ${allTerms.length} terms across ${years.length} years`);
  for (const { year, term } of allTerms) {
    writeLog(`  - ${year}/${term}`);
  }

  return allTerms;
}

async function main() {
  const args = parseArgs();
  const startTime = new Date();

  // Initialize file writers
  if (!args.dryRun) {
    sqlWriter = fs.createWriteStream(path.join(process.cwd(), args.sqlFile));
    writeLog(`SQL output: ${args.sqlFile}`);
  }
  logWriter = fs.createWriteStream(path.join(process.cwd(), args.logFile));
  writeLog(`Log output: ${args.logFile}`);

  writeLog(`\nHistorical Sync Starting...`);
  writeLog(`  Range: ${args.startYear} - ${args.endYear}`);
  writeLog(`  Term Filter: ${args.termFilter || '(all)'}`);
  writeLog(`  Dry Run: ${args.dryRun}`);
  writeLog(`  Fresh Start: ${args.fresh}`);

  // Load or clear checkpoint
  if (args.fresh) {
    clearCheckpoint();
  } else {
    loadCheckpoint();
  }

  // PHASE 1: Discover all terms upfront in parallel
  const allTerms = await discoverAllTerms(args.startYear, args.endYear, args.termFilter);

  if (allTerms.length === 0) {
    writeLog(`[WARNING] No terms found in range ${args.startYear}-${args.endYear}`);
    return;
  }

  // Print SQL header (idempotent - INSERT OR REPLACE handles duplicates)
  if (!args.dryRun) {
    writeSql('-- Historical course data sync');
    writeSql('-- Generated: ' + new Date().toISOString());
    writeSql(`-- Range: ${args.startYear} - ${args.endYear}`);
    writeSql(`-- Term Filter: ${args.termFilter || 'all'}`);
    writeSql('-- NOTE: Uses INSERT OR REPLACE for idempotency (safe to re-run)');
    writeSql('BEGIN TRANSACTION;');
  }

  // PHASE 2: Fetch all subjects for all terms in parallel
  writeLog(`\n[SUBJECTS] Fetching subject lists for all ${allTerms.length} terms in parallel...`);
  const termSubjectsResults = await Promise.all(
    allTerms.map(async ({ year, term }) => {
      const subjects = await getSubjects(year, term);
      return { year, term, subjects };
    })
  );

  // Build flat list of all (year, term, subject) work items
  const allWorkItems: { year: number; term: string; subject: string }[] = [];
  const uniqueYears = new Set<number>();
  for (const { year, term, subjects } of termSubjectsResults) {
    uniqueYears.add(year);
    stats.totalTerms++;
    writeLog(`[SUBJECTS] ${year}/${term}: ${subjects.length} subjects`);
    for (const subject of subjects) {
      allWorkItems.push({ year, term, subject });
    }
  }
  stats.totalYears = uniqueYears.size;

  writeLog(`\n[SYNC] Total work items: ${allWorkItems.length} subject-terms to fetch`);

  // Filter out already-completed items (checkpoint resume)
  const pendingWorkItems = allWorkItems.filter(
    ({ year, term, subject }) => !isCompleted(year, term, subject)
  );
  const skippedCount = allWorkItems.length - pendingWorkItems.length;
  if (skippedCount > 0) {
    writeLog(`[CHECKPOINT] Skipping ${skippedCount} already-completed items`);
  }
  writeLog(`[SYNC] Pending work items: ${pendingWorkItems.length}`);

  if (pendingWorkItems.length === 0) {
    writeLog(`[SYNC] All items already completed! Use --fresh to start over.`);
    printSummary(args, startTime);
    return;
  }

  writeLog(`[SYNC] Strategy: ${CONFIG.MAX_CONCURRENT} concurrent connections, ${CONFIG.BATCH_SIZE} items per batch`);

  // PHASE 3: Process ALL subjects across ALL terms in batches
  const termResults = new Map<string, { courses: number; sections: number; subjects: number }>();
  let completedItems = 0;
  let failedItems = 0;

  for (let batchStart = 0; batchStart < pendingWorkItems.length; batchStart += CONFIG.BATCH_SIZE) {
    const batch = pendingWorkItems.slice(batchStart, batchStart + CONFIG.BATCH_SIZE);
    const batchNum = Math.floor(batchStart / CONFIG.BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pendingWorkItems.length / CONFIG.BATCH_SIZE);

    // Record when this burst starts for accurate window tracking
    recordBurstStart();

    writeLog(`\n[BATCH ${batchNum}/${totalBatches}] Processing ${batch.length} items (${completedItems} done, ${failedItems} failed)...`);

    const results = await Promise.all(batch.map(async ({ year, term, subject }) => {
      const termId = `${year}-${term}`;

      try {
        const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;
        const xml = await robustFetch(url);
        const parsed = await parseSubjectCascadeXmlFromString(xml);
        const { subject: subjectMeta, coursesWithSections } = fromSubjectCascade(parsed, year, term);

        const now = Math.floor(Date.now() / 1000);
        const sqlStatements: string[] = [];

        if (!args.dryRun) {
          // 1. Subject metadata
          sqlStatements.push(`INSERT OR REPLACE INTO subjects (id, name, college_code, department_code, unit_name, contact_name, contact_title, address_line1, address_line2, phone_number, website_url, description, last_synced) VALUES (${escapeSQL(subjectMeta.id)}, ${escapeSQL(subjectMeta.name)}, ${escapeSQL(subjectMeta.college_code)}, ${escapeSQL(subjectMeta.department_code)}, ${escapeSQL(subjectMeta.unit_name)}, ${escapeSQL(subjectMeta.contact_name)}, ${escapeSQL(subjectMeta.contact_title)}, ${escapeSQL(subjectMeta.address_line1)}, ${escapeSQL(subjectMeta.address_line2)}, ${escapeSQL(subjectMeta.phone_number)}, ${escapeSQL(subjectMeta.website_url)}, ${escapeSQL(subjectMeta.description)}, ${now});`);

          for (const { course, sections, genEdCategories } of coursesWithSections) {
            // 2. Course
            sqlStatements.push(`INSERT OR REPLACE INTO courses (id, subject, number, title, description, credit_hours, gened, subject_id, course_info, degree_attributes, class_schedule_info, date_range_text, registration_notes, approval_code, year, term, primary_instructor, last_synced) VALUES (${escapeSQL(course.id)}, ${escapeSQL(course.subject)}, ${escapeSQL(course.number)}, ${escapeSQL(course.title)}, ${escapeSQL(course.description)}, ${course.credit_hours ?? 'NULL'}, ${escapeSQL(course.gened)}, ${escapeSQL(course.subject_id)}, ${escapeSQL(course.course_info)}, ${escapeSQL(course.degree_attributes)}, ${escapeSQL(course.class_schedule_info)}, ${escapeSQL(course.date_range_text)}, ${escapeSQL(course.registration_notes)}, ${escapeSQL(course.approval_code)}, ${course.year}, ${escapeSQL(course.term)}, ${escapeSQL(course.primary_instructor)}, ${now});`);

            // 3. Course GenEds
            sqlStatements.push(...courseGenedSqlStatements(course.id, genEdCategories));

            for (const { section, meetings } of sections) {
              // 4. Section
              sqlStatements.push(`INSERT OR REPLACE INTO sections (id, crn, course_id, term_id, section_number, status, type, days, start_time, end_time, location, instructor, section_title, status_code, section_status_code, section_text, section_notes, capp_area, date_range_text, part_of_term, start_date, end_date, credit_hours, last_synced) VALUES (${escapeSQL(section.id)}, ${escapeSQL(section.crn)}, ${escapeSQL(section.course_id)}, ${escapeSQL(section.term_id)}, ${escapeSQL(section.section_number)}, ${escapeSQL(section.status)}, ${escapeSQL(section.type)}, ${escapeSQL(section.days)}, ${escapeSQL(section.start_time)}, ${escapeSQL(section.end_time)}, ${escapeSQL(section.location)}, ${escapeSQL(section.instructor)}, ${escapeSQL(section.section_title)}, ${escapeSQL(section.status_code)}, ${escapeSQL(section.section_status_code)}, ${escapeSQL(section.section_text)}, ${escapeSQL(section.section_notes)}, ${escapeSQL(section.capp_area)}, ${escapeSQL(section.date_range_text)}, ${escapeSQL(section.part_of_term)}, ${escapeSQL(section.start_date)}, ${escapeSQL(section.end_date)}, ${escapeSQL(section.credit_hours)}, ${now});`);

              for (const meeting of meetings) {
                // 5. Meeting
                sqlStatements.push(`INSERT OR REPLACE INTO meetings (section_id, meeting_index, type_code, type_name, days, start_time, end_time, building_name, room_number, date_range_text) VALUES (${escapeSQL(meeting.section_id)}, ${meeting.meeting_index}, ${escapeSQL(meeting.type_code)}, ${escapeSQL(meeting.type_name)}, ${escapeSQL(meeting.days)}, ${escapeSQL(meeting.start_time)}, ${escapeSQL(meeting.end_time)}, ${escapeSQL(meeting.building_name)}, ${escapeSQL(meeting.room_number)}, ${escapeSQL(meeting.date_range_text)});`);

                for (const inst of meeting.instructors) {
                  // 6. Instructor
                  const displayName = formatInstructorName(inst) || inst.lastName;
                  const firstName = inst.firstName || '';
                  sqlStatements.push(`INSERT OR IGNORE INTO instructors (first_name, last_name, display_name) VALUES (${escapeSQL(firstName)}, ${escapeSQL(inst.lastName)}, ${escapeSQL(displayName)});`);

                  // 7. Meeting Instructor link
                  sqlStatements.push(`INSERT OR IGNORE INTO meeting_instructors (meeting_id, instructor_id) SELECT m.id, i.id FROM meetings m, instructors i WHERE m.section_id = ${escapeSQL(meeting.section_id)} AND m.meeting_index = ${meeting.meeting_index} AND i.last_name = ${escapeSQL(inst.lastName)} AND i.first_name = ${escapeSQL(firstName)};`);
                }
              }
            }
          }
        }

        return {
          year,
          term,
          termId,
          subject,
          success: true,
          coursesCount: coursesWithSections.length,
          sectionsCount: coursesWithSections.reduce((acc, c) => acc + c.sections.length, 0),
          sqlStatements
        };
      } catch (error) {
        const errorMsg = `${year}/${term}/${subject}: ${error}`;
        stats.failedSubjects.push(errorMsg);
        return {
          year,
          term,
          termId,
          subject,
          success: false,
          coursesCount: 0,
          sectionsCount: 0,
          sqlStatements: [],
          error: String(error)
        };
      }
    }));

    // Output results and accumulate stats
    let batchSuccess = 0;
    let batchFailed = 0;
    for (const result of results) {
      if (result.success) {
        for (const sql of result.sqlStatements) {
          writeSql(sql);
        }

        // Mark this item as completed in checkpoint
        markCompleted(result.year, result.term, result.subject);

        // Accumulate per-term stats
        const existing = termResults.get(result.termId) || { courses: 0, sections: 0, subjects: 0 };
        existing.courses += result.coursesCount;
        existing.sections += result.sectionsCount;
        existing.subjects += 1;
        termResults.set(result.termId, existing);

        stats.totalSubjects++;
        stats.totalCourses += result.coursesCount;
        stats.totalSections += result.sectionsCount;
        completedItems++;
        batchSuccess++;
      } else {
        failedItems++;
        batchFailed++;
      }
    }

    // Save checkpoint after each batch
    saveCheckpoint();

    writeLog(`[BATCH ${batchNum}/${totalBatches}] Complete: ${batchSuccess} succeeded, ${batchFailed} failed`);
  }

  // Output term_state for each term
  const now = Math.floor(Date.now() / 1000);
  if (!args.dryRun) {
    for (const [termId, termStats] of termResults) {
      const [yearStr, term] = termId.split('-');
      const year = parseInt(yearStr);
      writeSql(`INSERT OR REPLACE INTO term_state (term_id, year, term, status, last_checked, last_synced, subjects_count, courses_count, sections_count) VALUES (${escapeSQL(termId)}, ${year}, ${escapeSQL(term)}, 'historical', ${now}, ${now}, ${termStats.subjects}, ${termStats.courses}, ${termStats.sections});`);
    }
  }

  // Copy termResults to stats
  for (const [termId, termStats] of termResults) {
    stats.termStats.set(termId, termStats);
  }

  if (!args.dryRun) {
    writeSql('COMMIT;');
  }

  // Print comprehensive summary
  printSummary(args, startTime);

  // Close file writers
  if (sqlWriter) {
    sqlWriter.end();
  }
  if (logWriter) {
    logWriter.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    writeLog(`\n[FATAL ERROR] ${error}`);
    process.exit(1);
  });
}
