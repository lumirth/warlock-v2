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
import { makeCourseId } from '../apps/api/src/db/ids.ts';
import { fromSubjectCascade } from '../apps/api/src/transforms/course.ts';
import {
  courseGenedSqlStatements,
  escapeSqlValue,
  subjectSnapshotSqlStatements,
  termStateSqlStatements,
} from '../apps/api/src/services/course-snapshot-writer.ts';
import {
  COURSE_EXPLORER_BROWSER_HEADERS,
  CoordinatedRateLimitFetcher,
} from './lib/rate-limit-fetcher.ts';
import { HistoricalSyncCheckpointStore } from './lib/historical-checkpoint.ts';
import {
  discoverHistoricalTerms,
  getHistoricalSubjects,
} from './lib/historical-term-discovery.ts';

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

// Parse command line arguments
export interface HistoricalSyncArgs {
  startYear: number;
  endYear: number;
  termFilter: string | null;
  dryRun: boolean;
  fresh: boolean;
  allowPartialOutput: boolean;
  sqlFile: string;
  logFile: string;
}

type HistoricalSyncParseResult = HistoricalSyncArgs | { kind: 'help'; usage: string };

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

const checkpointStore = new HistoricalSyncCheckpointStore(
  path.join(process.cwd(), CONFIG.CHECKPOINT_FILE),
  writeLog,
);

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

export function historicalSyncUsage(currentYear = new Date().getFullYear()): string {
  return `
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
`;
}

export function parseHistoricalSyncArgs(
  args: string[],
  now = new Date(),
): HistoricalSyncParseResult {
  const currentYear = now.getFullYear();

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
        throw new Error(`Invalid --start-year value: ${arg}`);
      }
    } else if (arg.startsWith('--end-year=')) {
      endYear = parseInt(arg.split('=')[1], 10);
      if (isNaN(endYear)) {
        throw new Error(`Invalid --end-year value: ${arg}`);
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
      return { kind: 'help', usage: historicalSyncUsage(currentYear) };
    }
  }

  if (startYear > endYear) {
    throw new Error(`--start-year (${startYear}) cannot be greater than --end-year (${endYear})`);
  }

  // Generate default file names based on timestamp
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
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

const historicalFetcher = new CoordinatedRateLimitFetcher(
  {
    maxConcurrent: CONFIG.MAX_CONCURRENT,
    rateLimitWindowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
    rateLimitBufferMs: CONFIG.RATE_LIMIT_BUFFER_MS,
    networkTimeoutMs: CONFIG.NETWORK_TIMEOUT_MS,
    headers: COURSE_EXPLORER_BROWSER_HEADERS,
  },
  {
    log: writeLog,
    onRetry: () => {
      stats.retriedRequests++;
    },
  },
);

function recordBurstStart(): void {
  historicalFetcher.recordBurstStart();
}

async function robustFetch(url: string): Promise<string> {
  return historicalFetcher.fetchText(url);
}

function printSummary(args: HistoricalSyncArgs, startTime: Date): void {
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

function writeSqlHeader(args: HistoricalSyncArgs): void {
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
  const parsedArgs = parseHistoricalSyncArgs(process.argv.slice(2));
  if (isHistoricalSyncHelp(parsedArgs)) {
    console.log(parsedArgs.usage);
    return;
  }
  const args = parsedArgs;
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
    checkpointStore.clear();
  } else {
    checkpointStore.load();
  }

  // PHASE 1: Discover all terms upfront in parallel
  const allTerms = await discoverHistoricalTerms({
    startYear: args.startYear,
    endYear: args.endYear,
    termFilter: args.termFilter,
    config: {
      frontendBase: CONFIG.FRONTEND_BASE,
      cisapiBase: CONFIG.CISAPI_BASE,
    },
    fetchText: robustFetch,
    log: writeLog,
  });

  if (allTerms.length === 0) {
    writeLog(`[WARNING] No terms found in range ${args.startYear}-${args.endYear}`);
    await closeFileWriters();
    return;
  }

  // PHASE 2: Fetch all subjects for all terms in parallel
  writeLog(`\n[SUBJECTS] Fetching subject lists for all ${allTerms.length} terms in parallel...`);
  const termSubjectsResults = await Promise.all(
    allTerms.map(async ({ year, term }) => {
      const subjects = await getHistoricalSubjects(
        year,
        term,
        { cisapiBase: CONFIG.CISAPI_BASE },
        robustFetch,
      );
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
    item => !checkpointStore.isCompleted(item)
  );
  const skippedCount = allWorkItems.length - pendingWorkItems.length;
  const termResults = checkpointStore.termResultsFromCheckpoint(allWorkItems);
  const checkpointedWithoutStats = checkpointStore.checkpointedWithoutStats(allWorkItems);

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
        checkpointStore.markCompleted(result, {
          termId: result.termId,
          courses: result.coursesCount,
          sections: result.sectionsCount,
        });

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
    checkpointStore.save();

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

function isHistoricalSyncHelp(
  result: HistoricalSyncParseResult
): result is Extract<HistoricalSyncParseResult, { kind: 'help' }> {
  return (result as { kind?: string }).kind === 'help';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    writeLog(`\n[FATAL ERROR] ${error}`);
    process.exit(1);
  });
}
