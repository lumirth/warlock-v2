#!/usr/bin/env npx tsx
/**
 * Historical Sync Script
 *
 * Fetches all historical course data from CISAPI and writes SQL inserts
 * that can be executed against D1.
 *
 * Usage:
 *   npx tsx scripts/historical-sync.ts > historical-data.sql 2> historical-sync.log
 *   wrangler d1 execute course-search-db --remote --file=historical-data.sql
 *
 * Options:
 *   --start-year=YYYY  Start year (default: 2004)
 *   --end-year=YYYY    End year (default: current year)
 *   --term=TERM        Only sync specific term (e.g., spring, fall)
 *   --dry-run          Don't output SQL, just show what would be synced
 *   --fresh            Ignore checkpoint, start fresh
 *
 * Resume:
 *   The script saves progress to historical-sync-checkpoint.json after each batch.
 *   If interrupted, simply re-run the same command to resume where you left off.
 *   Use --fresh to ignore the checkpoint and start over.
 */

import * as fs from 'fs';
import * as path from 'path';

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
  RATE_LIMIT_WINDOW_MS: 5 * 60 * 1000,  // WAF uses 5-minute rolling window
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
      console.error(`[CHECKPOINT] Loaded ${completedSet.size} completed items from checkpoint`);
    }
  } catch (err) {
    console.error(`[CHECKPOINT] Could not load checkpoint: ${err}`);
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
    console.error(`[CHECKPOINT] Could not save checkpoint: ${err}`);
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
      console.error(`[CHECKPOINT] Cleared checkpoint file`);
    }
  } catch (err) {
    console.error(`[CHECKPOINT] Could not clear checkpoint: ${err}`);
  }
}

// =============================================================================
// ROBUST CONNECTION POOL WITH RATE LIMIT COORDINATION
// =============================================================================

// Global state for rate limiting
let isRateLimited = false;
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

  isRateLimited = true;
  const waitTime = getRateLimitWaitTime();
  const waitMin = (waitTime / 1000 / 60).toFixed(1);
  console.error(`\n[RATE LIMIT] Blocked - pausing all requests for ${waitMin}m...`);

  rateLimitPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.error(`[RATE LIMIT] Window expired - resuming`);
      isRateLimited = false;
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
  // eslint-disable-next-line no-constant-condition
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
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const currentYear = new Date().getFullYear();

  let startYear = CONFIG.START_YEAR;
  let endYear = currentYear;
  let termFilter: string | null = null;
  let dryRun = false;
  let fresh = false;

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
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--fresh') {
      fresh = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Historical Sync Script

Usage:
  npx tsx scripts/historical-sync.ts [options] > historical-data.sql

Options:
  --start-year=YYYY  Start year (default: ${CONFIG.START_YEAR})
  --end-year=YYYY    End year (default: ${currentYear})
  --term=TERM        Only sync specific term (e.g., spring, fall, summer, winter)
  --dry-run          Don't output SQL, just show what would be synced
  --fresh            Ignore checkpoint, start fresh
  --help, -h         Show this help message

Examples:
  npx tsx scripts/historical-sync.ts > all-data.sql
  npx tsx scripts/historical-sync.ts --start-year=2020 > recent-data.sql
  npx tsx scripts/historical-sync.ts --term=fall --start-year=2023 > fall-2023.sql
  npx tsx scripts/historical-sync.ts --dry-run
`);
      process.exit(0);
    }
  }

  if (startYear > endYear) {
    console.error(`Error: --start-year (${startYear}) cannot be greater than --end-year (${endYear})`);
    process.exit(1);
  }

  return { startYear, endYear, termFilter, dryRun, fresh };
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

interface Course {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  creditHours: string;
  gened: string | null;
}

interface Section {
  crn: string;
  sectionNumber: string;
  type: string;
  enrollmentStatus: string;
  startTime: string;
  endTime: string;
  daysOfTheWeek: string;
  buildingName: string;
  roomNumber: string;
  instructors: { firstName: string; lastName: string }[];
}

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

function parseSubjectCascade(xml: string, subjectId: string): { courses: Course[]; sections: Map<string, Section[]> } {
  const courses: Course[] = [];
  const sections = new Map<string, Section[]>();

  // Extract cascadingCourse blocks (the API uses this element name in cascade mode)
  const courseBlocks = xml.match(/<cascadingCourse id="[^"]*"[\s\S]*?<\/cascadingCourse>/g) || [];

  for (const block of courseBlocks) {
    // cascadingCourse id is like "CS 101" - extract course number from it
    const cascadeIdMatch = block.match(/<cascadingCourse id="[A-Z]+\s*(\d+[A-Z]*)"/i);
    const labelMatch = block.match(/<label>([^<]*)<\/label>/);
    const descMatch = block.match(/<description>([^<]*)<\/description>/);
    const creditMatch = block.match(/<creditHours>([^<]*)<\/creditHours>/);
    const genedMatch = block.match(/<category id="([^"]+)"/);

    if (cascadeIdMatch && labelMatch) {
      const courseNumber = cascadeIdMatch[1];
      const courseId = `${subjectId}-${courseNumber}`;
      courses.push({
        id: courseNumber,
        subject: subjectId,
        number: courseNumber,
        title: labelMatch[1],
        description: descMatch ? descMatch[1] : null,
        creditHours: creditMatch ? creditMatch[1] : '0',
        gened: genedMatch ? genedMatch[1] : null,
      });

      // Parse sections for this course (API uses detailedSection in cascade mode)
      const courseSections: Section[] = [];
      const sectionBlocks = block.match(/<detailedSection id="[^"]*"[\s\S]*?<\/detailedSection>/g) || [];

      for (const sectionBlock of sectionBlocks) {
        const crnMatch = sectionBlock.match(/<detailedSection id="(\d+)"/);
        const sectionNumMatch = sectionBlock.match(/<sectionNumber>([^<]*)<\/sectionNumber>/);
        const typeMatch = sectionBlock.match(/<type[^>]*>([^<]*)<\/type>/);
        const statusMatch = sectionBlock.match(/<enrollmentStatus>([^<]*)<\/enrollmentStatus>/);
        const startMatch = sectionBlock.match(/<start>([^<]*)<\/start>/);
        const endMatch = sectionBlock.match(/<end>([^<]*)<\/end>/);
        const daysMatch = sectionBlock.match(/<daysOfTheWeek>([^<]*)<\/daysOfTheWeek>/);
        const buildingMatch = sectionBlock.match(/<buildingName>([^<]*)<\/buildingName>/);
        const roomMatch = sectionBlock.match(/<roomNumber>([^<]*)<\/roomNumber>/);

        // Parse instructors
        const instructors: { firstName: string; lastName: string }[] = [];
        const instructorBlocks = sectionBlock.match(/<instructor>[\s\S]*?<\/instructor>/g) || [];
        for (const instBlock of instructorBlocks) {
          const firstMatch = instBlock.match(/<firstName>([^<]*)<\/firstName>/);
          const lastMatch = instBlock.match(/<lastName>([^<]*)<\/lastName>/);
          if (firstMatch && lastMatch) {
            instructors.push({ firstName: firstMatch[1], lastName: lastMatch[1] });
          }
        }

        if (crnMatch) {
          courseSections.push({
            crn: crnMatch[1],
            sectionNumber: sectionNumMatch ? sectionNumMatch[1] : '',
            type: typeMatch ? typeMatch[1] : '',
            enrollmentStatus: statusMatch ? statusMatch[1] : 'UNKNOWN',
            startTime: startMatch ? startMatch[1] : '',
            endTime: endMatch ? endMatch[1] : '',
            daysOfTheWeek: daysMatch ? daysMatch[1] : '',
            buildingName: buildingMatch ? buildingMatch[1] : '',
            roomNumber: roomMatch ? roomMatch[1] : '',
            instructors,
          });
        }
      }

      sections.set(courseId, courseSections);
    }
  }

  return { courses, sections };
}

function escapeSQL(str: string | null): string {
  if (str === null) return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

function printSummary(args: Args, startTime: Date): void {
  const endTime = new Date();
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMin = (durationMs / 1000 / 60).toFixed(2);

  console.error(`\n${'='.repeat(60)}`);
  console.error(`HISTORICAL SYNC SUMMARY`);
  console.error(`${'='.repeat(60)}`);
  console.error(`\nConfiguration:`);
  console.error(`  Start Year:    ${args.startYear}`);
  console.error(`  End Year:      ${args.endYear}`);
  console.error(`  Term Filter:   ${args.termFilter || '(all terms)'}`);
  console.error(`  Dry Run:       ${args.dryRun}`);

  console.error(`\nResults:`);
  console.error(`  Years Synced:      ${stats.totalYears}`);
  console.error(`  Terms Synced:      ${stats.totalTerms}`);
  console.error(`  Subjects Synced:   ${stats.totalSubjects}`);
  console.error(`  Courses Synced:    ${stats.totalCourses}`);
  console.error(`  Sections Synced:   ${stats.totalSections}`);
  console.error(`  Retried Requests:  ${stats.retriedRequests}`);
  console.error(`  Failed Subjects:   ${stats.failedSubjects.length}`);

  console.error(`\nTiming:`);
  console.error(`  Started:    ${startTime.toISOString()}`);
  console.error(`  Completed:  ${endTime.toISOString()}`);
  console.error(`  Duration:   ${durationMin} minutes`);

  if (stats.failedSubjects.length > 0) {
    console.error(`\n[WARNING] Failed subjects (${stats.failedSubjects.length}):`);
    for (const failure of stats.failedSubjects) {
      console.error(`  - ${failure}`);
    }
  }

  console.error(`\nPer-Term Breakdown:`);
  for (const [termId, termStats] of stats.termStats) {
    console.error(`  ${termId}: ${termStats.subjects} subjects, ${termStats.courses} courses, ${termStats.sections} sections`);
  }

  // Final status
  console.error(`\n${'='.repeat(60)}`);
  if (stats.failedSubjects.length === 0) {
    console.error(`✓ SYNC COMPLETE - All data fetched successfully`);
  } else {
    console.error(`⚠ SYNC COMPLETE WITH ERRORS - ${stats.failedSubjects.length} subjects failed`);
    console.error(`  Consider re-running with specific term to retry failed subjects`);
  }
  console.error(`${'='.repeat(60)}\n`);
}

async function discoverAllTerms(startYear: number, endYear: number, termFilter: string | null): Promise<{ year: number; term: string }[]> {
  console.error(`\n[DISCOVERY] Fetching all terms for years ${startYear}-${endYear} in parallel...`);

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

  console.error(`[DISCOVERY] Found ${allTerms.length} terms across ${years.length} years`);
  for (const { year, term } of allTerms) {
    console.error(`  - ${year}/${term}`);
  }

  return allTerms;
}

async function main() {
  const args = parseArgs();
  const startTime = new Date();

  console.error(`\nHistorical Sync Starting...`);
  console.error(`  Range: ${args.startYear} - ${args.endYear}`);
  console.error(`  Term Filter: ${args.termFilter || '(all)'}`);
  console.error(`  Dry Run: ${args.dryRun}`);
  console.error(`  Fresh Start: ${args.fresh}`);

  // Load or clear checkpoint
  if (args.fresh) {
    clearCheckpoint();
  } else {
    loadCheckpoint();
  }

  // PHASE 1: Discover all terms upfront in parallel
  const allTerms = await discoverAllTerms(args.startYear, args.endYear, args.termFilter);

  if (allTerms.length === 0) {
    console.error(`[WARNING] No terms found in range ${args.startYear}-${args.endYear}`);
    return;
  }

  // Print SQL header (idempotent - INSERT OR REPLACE handles duplicates)
  if (!args.dryRun) {
    console.log('-- Historical course data sync');
    console.log('-- Generated: ' + new Date().toISOString());
    console.log(`-- Range: ${args.startYear} - ${args.endYear}`);
    console.log(`-- Term Filter: ${args.termFilter || 'all'}`);
    console.log('-- NOTE: Uses INSERT OR REPLACE for idempotency (safe to re-run)');
    console.log('BEGIN TRANSACTION;');
  }

  // PHASE 2: Fetch all subjects for all terms in parallel
  console.error(`\n[SUBJECTS] Fetching subject lists for all ${allTerms.length} terms in parallel...`);
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
    console.error(`[SUBJECTS] ${year}/${term}: ${subjects.length} subjects`);
    for (const subject of subjects) {
      allWorkItems.push({ year, term, subject });
    }
  }
  stats.totalYears = uniqueYears.size;

  console.error(`\n[SYNC] Total work items: ${allWorkItems.length} subject-terms to fetch`);

  // Filter out already-completed items (checkpoint resume)
  const pendingWorkItems = allWorkItems.filter(
    ({ year, term, subject }) => !isCompleted(year, term, subject)
  );
  const skippedCount = allWorkItems.length - pendingWorkItems.length;
  if (skippedCount > 0) {
    console.error(`[CHECKPOINT] Skipping ${skippedCount} already-completed items`);
  }
  console.error(`[SYNC] Pending work items: ${pendingWorkItems.length}`);

  if (pendingWorkItems.length === 0) {
    console.error(`[SYNC] All items already completed! Use --fresh to start over.`);
    printSummary(args, startTime);
    return;
  }

  console.error(`[SYNC] Strategy: ${CONFIG.MAX_CONCURRENT} concurrent connections, ${CONFIG.BATCH_SIZE} items per batch`);

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

    console.error(`\n[BATCH ${batchNum}/${totalBatches}] Processing ${batch.length} items (${completedItems} done, ${failedItems} failed)...`);

    const results = await Promise.all(batch.map(async ({ year, term, subject }) => {
      const termId = `${year}-${term}`;

      try {
        const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;
        const xml = await robustFetch(url);
        const { courses, sections } = parseSubjectCascade(xml, subject);

        const now = Math.floor(Date.now() / 1000);
        const sqlStatements: string[] = [];

        for (const course of courses) {
          const courseId = makeCourseId(subject, course.number, year, term);
          const courseSections = sections.get(`${subject}-${course.number}`) || [];

          const lectureSection = courseSections.find(s =>
            s.type.toLowerCase().includes('lecture') || s.type.toLowerCase().includes('lec')
          ) || courseSections[0];
          const primaryInstructor = lectureSection?.instructors[0];
          const primaryInstructorName = primaryInstructor
            ? `${primaryInstructor.lastName}${primaryInstructor.firstName ? `, ${primaryInstructor.firstName.charAt(0)}` : ''}`
            : null;

          const creditHours = parseInt(course.creditHours) || null;

          if (!args.dryRun) {
            sqlStatements.push(`INSERT OR REPLACE INTO courses (id, subject, number, title, description, credit_hours, gened, year, term, primary_instructor, last_synced) VALUES (${escapeSQL(courseId)}, ${escapeSQL(subject)}, ${escapeSQL(course.number)}, ${escapeSQL(course.title)}, ${escapeSQL(course.description)}, ${creditHours ?? 'NULL'}, ${escapeSQL(course.gened)}, ${year}, ${escapeSQL(term)}, ${escapeSQL(primaryInstructorName)}, ${now});`);
          }

          for (const section of courseSections) {
            const instructorName = section.instructors[0]
              ? `${section.instructors[0].lastName}${section.instructors[0].firstName ? `, ${section.instructors[0].firstName.charAt(0)}` : ''}`
              : null;
            const location = `${section.buildingName} ${section.roomNumber}`.trim() || null;

            if (!args.dryRun) {
              sqlStatements.push(`INSERT OR REPLACE INTO sections (crn, course_id, section_number, status, type, days, start_time, end_time, location, instructor, last_synced) VALUES (${escapeSQL(section.crn)}, ${escapeSQL(courseId)}, ${escapeSQL(section.sectionNumber)}, ${escapeSQL(section.enrollmentStatus)}, ${escapeSQL(section.type)}, ${escapeSQL(section.daysOfTheWeek)}, ${escapeSQL(section.startTime || null)}, ${escapeSQL(section.endTime || null)}, ${escapeSQL(location)}, ${escapeSQL(instructorName)}, ${now});`);
            }
          }
        }

        return {
          year,
          term,
          termId,
          subject,
          success: true,
          coursesCount: courses.length,
          sectionsCount: sections.size,
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
          console.log(sql);
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

    console.error(`[BATCH ${batchNum}/${totalBatches}] Complete: ${batchSuccess} succeeded, ${batchFailed} failed`);
  }

  // Output term_state for each term
  const now = Math.floor(Date.now() / 1000);
  if (!args.dryRun) {
    for (const [termId, termStats] of termResults) {
      const [yearStr, term] = termId.split('-');
      const year = parseInt(yearStr);
      console.log(`INSERT OR REPLACE INTO term_state (term_id, year, term, status, last_checked, last_synced, subjects_count, courses_count, sections_count) VALUES (${escapeSQL(termId)}, ${year}, ${escapeSQL(term)}, 'historical', ${now}, ${now}, ${termStats.subjects}, ${termStats.courses}, ${termStats.sections});`);
    }
  }

  // Copy termResults to stats
  for (const [termId, termStats] of termResults) {
    stats.termStats.set(termId, termStats);
  }

  if (!args.dryRun) {
    console.log('COMMIT;');
  }

  // Print comprehensive summary
  printSummary(args, startTime);
}

main().catch(error => {
  console.error(`\n[FATAL ERROR] ${error}`);
  process.exit(1);
});
