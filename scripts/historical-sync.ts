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
 *   --allow-partial-output  Exit successfully even if some subjects fail
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
import { parseSubjectCascadeXmlFromString } from '../apps/api/src/cisapi/parser.ts';
import { makeCourseId, makeTermId } from '../apps/api/src/db/ids.ts';
import { fromSubjectCascade } from '../apps/api/src/transforms/course.ts';
import {
  courseGenedSqlStatements,
  escapeSqlValue,
  subjectSnapshotSqlStatements,
  termStateSqlStatements,
} from '../apps/api/src/services/course-snapshot-writer.ts';

export { makeCourseId };
export { courseGenedSqlStatements };
export const escapeSQL = escapeSqlValue;

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
  completedItemStats?: Record<string, { termId: string; courses: number; sections: number }>;
  lastUpdated: string;
}

const completedSet = new Set<string>();
const completedItemStats = new Map<string, { termId: string; courses: number; sections: number }>();

function makeItemKey(year: number, term: string, subject: string): string {
  return `${year}-${term}-${subject}`;
}

function loadCheckpoint(): void {
  completedSet.clear();
  completedItemStats.clear();
  const checkpointPath = path.join(process.cwd(), CONFIG.CHECKPOINT_FILE);
  try {
    if (fs.existsSync(checkpointPath)) {
      const data = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as Checkpoint;
      for (const key of data.completedItems) {
        completedSet.add(key);
      }
      for (const [key, value] of Object.entries(data.completedItemStats ?? {})) {
        completedItemStats.set(key, value);
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
    completedItemStats: Object.fromEntries(completedItemStats),
    lastUpdated: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));
  } catch (err) {
    writeLog(`[CHECKPOINT] Could not save checkpoint: ${err}`);
  }
}

function markCompleted(year: number, term: string, subject: string, courses: number, sections: number): void {
  const key = makeItemKey(year, term, subject);
  completedSet.add(key);
  completedItemStats.set(key, {
    termId: makeTermId(year, term),
    courses,
    sections,
  });
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
    completedSet.clear();
    completedItemStats.clear();
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
  allowPartialOutput: boolean;
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

export type SqlOutputPlan = {
  enabled: boolean;
  flags: 'w' | 'a';
  writeHeader: boolean;
  mode: 'dry-run' | 'fresh' | 'new' | 'resume';
};

export function chooseSqlOutputPlan(options: {
  dryRun: boolean;
  fresh: boolean;
  skippedCount: number;
  sqlFileExists: boolean;
  sqlFileHasCommit: boolean;
}): SqlOutputPlan {
  if (options.dryRun) {
    return { enabled: false, flags: 'w', writeHeader: false, mode: 'dry-run' };
  }

  if (options.fresh || options.skippedCount === 0) {
    return {
      enabled: true,
      flags: 'w',
      writeHeader: true,
      mode: options.fresh ? 'fresh' : 'new',
    };
  }

  if (!options.sqlFileExists) {
    throw new Error('Checkpointed items exist, but the SQL file is missing. Re-run with --fresh or restore the original SQL file before resuming.');
  }

  if (options.sqlFileHasCommit) {
    throw new Error('Checkpointed items exist, but the SQL file already contains COMMIT. Use a new --sql-file with --fresh for another generated artifact.');
  }

  return { enabled: true, flags: 'a', writeHeader: false, mode: 'resume' };
}

function sqlFileHasCommit(sqlPath: string): boolean {
  try {
    return /(?:^|\n)COMMIT;\s*$/i.test(fs.readFileSync(sqlPath, 'utf-8').trimEnd());
  } catch {
    return false;
  }
}

function closeWriter(writer: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.once('error', reject);
    writer.end(resolve);
  });
}

async function closeFileWriters(): Promise<void> {
  const writers = [sqlWriter, logWriter].filter((writer): writer is fs.WriteStream => writer !== null);
  sqlWriter = null;
  logWriter = null;
  await Promise.all(writers.map(closeWriter));
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const currentYear = new Date().getFullYear();

  let startYear: number = CONFIG.START_YEAR;
  let endYear = currentYear;
  let termFilter: string | null = null;
  let dryRun = false;
  let fresh = false;
  let allowPartialOutput = false;
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
    } else if (arg === '--allow-partial-output') {
      allowPartialOutput = true;
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
  --allow-partial-output
                    Exit successfully even if some subjects fail
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

  return { startYear, endYear, termFilter, dryRun, fresh, allowPartialOutput, sqlFile, logFile };
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

function termResultsFromCheckpoint(
  workItems: { year: number; term: string; subject: string }[]
): Map<string, { courses: number; sections: number; subjects: number }> {
  const currentKeys = new Set(workItems.map(item => makeItemKey(item.year, item.term, item.subject)));
  const termResults = new Map<string, { courses: number; sections: number; subjects: number }>();

  for (const [key, itemStats] of completedItemStats) {
    if (!currentKeys.has(key)) continue;
    const existing = termResults.get(itemStats.termId) || { courses: 0, sections: 0, subjects: 0 };
    existing.courses += itemStats.courses;
    existing.sections += itemStats.sections;
    existing.subjects += 1;
    termResults.set(itemStats.termId, existing);
  }

  return termResults;
}

function writeSqlHeader(args: Args): void {
  writeSql('-- Historical course data sync');
  writeSql('-- Generated: ' + new Date().toISOString());
  writeSql(`-- Range: ${args.startYear} - ${args.endYear}`);
  writeSql(`-- Term Filter: ${args.termFilter || 'all'}`);
  writeSql('-- NOTE: Uses idempotent upserts (safe to re-run)');
  writeSql('BEGIN TRANSACTION;');
}

function writeTermStateSql(termResults: Map<string, { courses: number; sections: number; subjects: number }>): void {
  for (const sql of termStateSqlStatements(termResults)) {
    writeSql(sql);
  }
}

async function main() {
  const args = parseArgs();
  const startTime = new Date();

  // Initialize log writer immediately; SQL writer is opened after checkpoint filtering
  // so a resumed run cannot truncate already-generated SQL before deciding append/refuse.
  logWriter = fs.createWriteStream(path.join(process.cwd(), args.logFile));
  writeLog(`Log output: ${args.logFile}`);

  writeLog(`\nHistorical Sync Starting...`);
  writeLog(`  Range: ${args.startYear} - ${args.endYear}`);
  writeLog(`  Term Filter: ${args.termFilter || '(all)'}`);
  writeLog(`  Dry Run: ${args.dryRun}`);
  writeLog(`  Fresh Start: ${args.fresh}`);
  writeLog(`  Allow Partial Output: ${args.allowPartialOutput}`);

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
    await closeFileWriters();
    return;
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
  const termResults = termResultsFromCheckpoint(allWorkItems);
  const checkpointedWithoutStats = allWorkItems.filter(
    ({ year, term, subject }) => {
      const key = makeItemKey(year, term, subject);
      return completedSet.has(key) && !completedItemStats.has(key);
    }
  ).length;

  if (!args.dryRun && checkpointedWithoutStats > 0) {
    throw new Error('[CHECKPOINT] Existing checkpoint does not include SQL generation stats. Re-run with --fresh or restore a checkpoint created by the current script.');
  }

  const sqlPath = path.join(process.cwd(), args.sqlFile);
  const sqlPlan = chooseSqlOutputPlan({
    dryRun: args.dryRun,
    fresh: args.fresh,
    skippedCount,
    sqlFileExists: fs.existsSync(sqlPath),
    sqlFileHasCommit: sqlFileHasCommit(sqlPath),
  });

  if (sqlPlan.enabled) {
    sqlWriter = fs.createWriteStream(sqlPath, { flags: sqlPlan.flags });
    writeLog(`SQL output: ${args.sqlFile} (${sqlPlan.mode === 'resume' ? 'append resume' : 'new file'})`);
    if (sqlPlan.writeHeader) {
      writeSqlHeader(args);
    }
  }

  if (skippedCount > 0) {
    writeLog(`[CHECKPOINT] Skipping ${skippedCount} already-completed items`);
  }
  writeLog(`[SYNC] Pending work items: ${pendingWorkItems.length}`);

  if (pendingWorkItems.length === 0) {
    writeLog(`[SYNC] All items already completed! Use --fresh to start over.`);
    if (!args.dryRun && sqlPlan.mode === 'resume') {
      writeTermStateSql(termResults);
      writeSql('COMMIT;');
    }
    for (const [termId, termStats] of termResults) {
      stats.termStats.set(termId, termStats);
    }
    printSummary(args, startTime);
    await closeFileWriters();
    return;
  }

  writeLog(`[SYNC] Strategy: ${CONFIG.MAX_CONCURRENT} concurrent connections, ${CONFIG.BATCH_SIZE} items per batch`);

  // PHASE 3: Process ALL subjects across ALL terms in batches
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
        const snapshot = fromSubjectCascade(parsed, year, term);
        const sqlStatements = args.dryRun ? [] : subjectSnapshotSqlStatements(snapshot);

        return {
          year,
          term,
          termId: snapshot.termId,
          subject,
          success: true,
          coursesCount: snapshot.courses.length,
          sectionsCount: snapshot.courses.reduce((acc, course) => acc + course.sections.length, 0),
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

        // Mark this item as completed in checkpoint after its SQL has been written.
        markCompleted(result.year, result.term, result.subject, result.coursesCount, result.sectionsCount);

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

  if (!args.dryRun) {
    writeTermStateSql(termResults);
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
  await closeFileWriters();

  if (stats.failedSubjects.length > 0 && !args.allowPartialOutput) {
    throw new Error(`Historical sync failed for ${stats.failedSubjects.length} subject(s). Re-run with --allow-partial-output to accept partial SQL output.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    writeLog(`\n[FATAL ERROR] ${error}`);
    process.exit(1);
  });
}
