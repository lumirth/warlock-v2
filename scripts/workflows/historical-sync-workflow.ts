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
 *   The script atomically saves progress and the durable SQL byte position after each batch.
 *   If interrupted, re-run the same command; uncheckpointed SQL is discarded before resuming.
 *   Use --fresh to ignore the checkpoint and start over.
 *   Dry runs never read, clear, or write resumable progress.
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { parseSubjectCascadeXmlFromString } from "../../apps/api/src/cisapi/parser.ts";
import { fromSubjectCascade } from "../../apps/api/src/transforms/course.ts";
import {
  subjectSnapshotSqlStatements,
  termStateSqlStatements,
} from "../../apps/api/src/services/course-snapshot-writer.ts";
import {
  COURSE_EXPLORER_BROWSER_HEADERS,
  CoordinatedRateLimitFetcher,
} from "../lib/rate-limit-fetcher.ts";
import { HistoricalSyncCheckpointStore } from "../lib/historical-checkpoint.ts";
import {
  discoverHistoricalTerms,
  getHistoricalSubjects,
} from "../lib/historical-term-discovery.ts";
import {
  HISTORICAL_SYNC_CONFIG as CONFIG,
  isHistoricalSyncHelp,
  parseHistoricalSyncArgs,
  type HistoricalSyncArgs,
} from "../lib/historical-sync-config.ts";
import {
  chooseSqlOutputPlan,
  reconcileSqlOutputWithCheckpoint,
  sqlFileHasCommit as sqlContentsHaveCommit,
} from "../lib/historical-sync-sql-output.ts";

function sqlPathHasCommit(sqlPath: string): boolean {
  return sqlContentsHaveCommit(fs.readFileSync(sqlPath, "utf-8"));
}

function closeWriter(writer: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.once("error", reject);
    writer.end(resolve);
  });
}

interface SyncStats {
  totalYears: number;
  totalTerms: number;
  totalSubjects: number;
  totalCourses: number;
  totalSections: number;
  failedSubjects: string[];
  retriedRequests: number;
  termStats: Map<
    string,
    { courses: number; sections: number; subjects: number }
  >;
}

function createSyncStats(): SyncStats {
  return {
    totalYears: 0,
    totalTerms: 0,
    totalSubjects: 0,
    totalCourses: 0,
    totalSections: 0,
    failedSubjects: [],
    retriedRequests: 0,
    termStats: new Map(),
  };
}

type HistoricalSyncRuntime = {
  stats: SyncStats;
  checkpointStore: HistoricalSyncCheckpointStore;
  openLogWriter: (filePath: string) => void;
  openSqlWriter: (filePath: string, flags: "a" | "w") => void;
  writeSql: (line: string) => void;
  flushSql: () => { path: string; committedBytes: number } | undefined;
  writeLog: (message: string) => void;
  recordBurstStart: () => void;
  robustFetch: (url: string) => Promise<string>;
  closeFileWriters: () => Promise<void>;
  printSummary: () => void;
  writeSqlHeader: () => void;
  writeTermStateSql: (
    termResults: Map<
      string,
      { courses: number; sections: number; subjects: number }
    >,
  ) => void;
};

function createHistoricalSyncRuntime(
  args: HistoricalSyncArgs,
  startTime: Date,
  cwd = process.cwd(),
): HistoricalSyncRuntime {
  let sqlPath: string | null = null;
  let sqlBuffer: string[] = [];
  let logWriter: fs.WriteStream | null = null;
  const stats = createSyncStats();

  const writeSql = (line: string): void => {
    if (sqlPath) {
      sqlBuffer.push(line);
    }
  };

  const flushSql = (): { path: string; committedBytes: number } | undefined => {
    if (!sqlPath) {
      return undefined;
    }
    if (sqlBuffer.length > 0) {
      const descriptor = fs.openSync(sqlPath, "a");
      try {
        fs.writeFileSync(descriptor, `${sqlBuffer.join("\n")}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      sqlBuffer = [];
    }
    return {
      path: path.resolve(sqlPath),
      committedBytes: fs.statSync(sqlPath).size,
    };
  };

  const writeLog = (message: string): void => {
    console.log(message);
    if (logWriter) {
      logWriter.write(message + "\n");
    }
  };

  const checkpointStore = new HistoricalSyncCheckpointStore(
    path.join(cwd, CONFIG.CHECKPOINT_FILE),
    writeLog,
  );

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

  const closeFileWriters = async (): Promise<void> => {
    flushSql();
    const writers = [logWriter].filter((writer): writer is fs.WriteStream => writer !== null);
    sqlPath = null;
    logWriter = null;
    await Promise.all(writers.map(closeWriter));
  };

  const printSummary = (): void => {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMin = (durationMs / 1000 / 60).toFixed(2);

    writeLog(`\n${"=".repeat(60)}`);
    writeLog(`HISTORICAL SYNC SUMMARY`);
    writeLog(`${"=".repeat(60)}`);
    writeLog(`\nConfiguration:`);
    writeLog(`  Start Year:    ${args.startYear}`);
    writeLog(`  End Year:      ${args.endYear}`);
    writeLog(`  Term Filter:   ${args.termFilter || "(all terms)"}`);
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
      writeLog(
        `  ${termId}: ${termStats.subjects} subjects, ${termStats.courses} courses, ${termStats.sections} sections`,
      );
    }

    writeLog(`\n${"=".repeat(60)}`);
    if (stats.failedSubjects.length === 0) {
      writeLog(`✓ SYNC COMPLETE - All data fetched successfully`);
    } else {
      writeLog(
        `⚠ SYNC COMPLETE WITH ERRORS - ${stats.failedSubjects.length} subjects failed`,
      );
      writeLog(
        `  Consider re-running with specific term to retry failed subjects`,
      );
    }
    writeLog(`${"=".repeat(60)}\n`);
  };

  const writeSqlHeader = (): void => {
    writeSql("-- Historical course data sync");
    writeSql("-- Generated: " + new Date().toISOString());
    writeSql(`-- Range: ${args.startYear} - ${args.endYear}`);
    writeSql(`-- Term Filter: ${args.termFilter || "all"}`);
    writeSql("-- NOTE: Uses idempotent upserts (safe to re-run)");
    writeSql("BEGIN TRANSACTION;");
  };

  const writeTermStateSql = (
    termResults: Map<
      string,
      { courses: number; sections: number; subjects: number }
    >,
  ): void => {
    for (const sql of termStateSqlStatements(termResults)) {
      writeSql(sql);
    }
  };

  return {
    stats,
    checkpointStore,
    openLogWriter: (filePath) => {
      logWriter = fs.createWriteStream(filePath);
    },
    openSqlWriter: (filePath, flags) => {
      if (flags === "w") {
        fs.writeFileSync(filePath, "");
      }
      sqlPath = filePath;
    },
    writeSql,
    flushSql,
    writeLog,
    recordBurstStart: () => historicalFetcher.recordBurstStart(),
    robustFetch: (url) => historicalFetcher.fetchText(url),
    closeFileWriters,
    printSummary,
    writeSqlHeader,
    writeTermStateSql,
  };
}

export async function runHistoricalSyncCli(
  argv = process.argv.slice(2),
): Promise<void> {
  const parsedArgs = parseHistoricalSyncArgs(argv);
  if (isHistoricalSyncHelp(parsedArgs)) {
    console.log(parsedArgs.usage);
    return;
  }
  const args = parsedArgs;
  const startTime = new Date();
  const runtime = createHistoricalSyncRuntime(args, startTime);
  const sqlPath = path.resolve(process.cwd(), args.sqlFile);
  const checkpointScope = {
    startYear: args.startYear,
    endYear: args.endYear,
    termFilter: args.termFilter,
  };
  const {
    checkpointStore,
    closeFileWriters,
    printSummary,
    recordBurstStart,
    robustFetch,
    stats,
    writeLog,
    writeSql,
    flushSql,
    writeSqlHeader,
    writeTermStateSql,
  } = runtime;

  try {
    // Initialize log writer immediately; SQL writer is opened after checkpoint filtering
    // so a resumed run cannot truncate already-generated SQL before deciding append/refuse.
    runtime.openLogWriter(path.join(process.cwd(), args.logFile));
    writeLog(`Log output: ${args.logFile}`);

    writeLog(`\nHistorical Sync Starting...`);
    writeLog(`  Range: ${args.startYear} - ${args.endYear}`);
    writeLog(`  Term Filter: ${args.termFilter || "(all)"}`);
    writeLog(`  Dry Run: ${args.dryRun}`);
    writeLog(`  Fresh Start: ${args.fresh}`);
    writeLog(`  Allow Partial Output: ${args.allowPartialOutput}`);

    // Dry runs inspect the requested source range without mutating resumable progress.
    if (!args.dryRun) {
      if (args.fresh) {
        checkpointStore.clear();
      } else {
        checkpointStore.load();
        checkpointStore.assertCompatible(checkpointScope, sqlPath);
      }
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
      writeLog(
        `[WARNING] No terms found in range ${args.startYear}-${args.endYear}`,
      );
      await closeFileWriters();
      return;
    }

    // PHASE 2: Fetch all subjects for all terms in parallel
    writeLog(
      `\n[SUBJECTS] Fetching subject lists for all ${allTerms.length} terms in parallel...`,
    );
    const termSubjectsResults = await Promise.all(
      allTerms.map(async ({ year, term }) => {
        const subjects = await getHistoricalSubjects(
          year,
          term,
          { cisapiBase: CONFIG.CISAPI_BASE },
          robustFetch,
        );
        return { year, term, subjects };
      }),
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

    writeLog(
      `\n[SYNC] Total work items: ${allWorkItems.length} subject-terms to fetch`,
    );

    // Filter out already-completed items (checkpoint resume)
    const pendingWorkItems = allWorkItems.filter(
      (item) => !checkpointStore.isCompleted(item),
    );
    const skippedCount = allWorkItems.length - pendingWorkItems.length;
    const termResults = checkpointStore.termResultsFromCheckpoint(allWorkItems);
    const checkpointedWithoutStats = checkpointStore.checkpointedWithoutStats(allWorkItems);

    if (!args.dryRun && checkpointedWithoutStats > 0) {
      throw new Error(
        "[CHECKPOINT] Existing checkpoint does not include SQL generation stats. Re-run with --fresh or restore a checkpoint created by the current script.",
      );
    }

    const sqlFileExists = fs.existsSync(sqlPath);
    const sqlPlan = chooseSqlOutputPlan({
      dryRun: args.dryRun,
      fresh: args.fresh,
      skippedCount,
      sqlFileExists,
      sqlFileHasCommit: !args.dryRun && sqlFileExists && sqlPathHasCommit(sqlPath),
    });

    if (sqlPlan.enabled) {
      if (sqlPlan.mode === "resume") {
        reconcileSqlOutputWithCheckpoint(sqlPath, checkpointStore.getSqlOutput());
      }
      runtime.openSqlWriter(sqlPath, sqlPlan.flags);
      writeLog(
        `SQL output: ${args.sqlFile} (${sqlPlan.mode === "resume" ? "append resume" : "new file"})`,
      );
      if (sqlPlan.writeHeader) {
        writeSqlHeader();
      }
    }

    if (skippedCount > 0) {
      writeLog(`[CHECKPOINT] Skipping ${skippedCount} already-completed items`);
    }
    writeLog(`[SYNC] Pending work items: ${pendingWorkItems.length}`);

    if (pendingWorkItems.length === 0) {
      writeLog(
        `[SYNC] All items already completed! Use --fresh to start over.`,
      );
      if (!args.dryRun && sqlPlan.mode === "resume") {
        writeTermStateSql(termResults);
        writeSql("COMMIT;");
      }
      for (const [termId, termStats] of termResults) {
        stats.termStats.set(termId, termStats);
      }
      printSummary();
      await closeFileWriters();
      return;
    }

    writeLog(
      `[SYNC] Strategy: ${CONFIG.MAX_CONCURRENT} concurrent connections, ${CONFIG.BATCH_SIZE} items per batch`,
    );

    // PHASE 3: Process ALL subjects across ALL terms in batches
    let completedItems = 0;
    let failedItems = 0;

    for (
      let batchStart = 0;
      batchStart < pendingWorkItems.length;
      batchStart += CONFIG.BATCH_SIZE
    ) {
      const batch = pendingWorkItems.slice(
        batchStart,
        batchStart + CONFIG.BATCH_SIZE,
      );
      const batchNum = Math.floor(batchStart / CONFIG.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(
        pendingWorkItems.length / CONFIG.BATCH_SIZE,
      );

      // Record when this burst starts for accurate window tracking
      recordBurstStart();

      writeLog(
        `\n[BATCH ${batchNum}/${totalBatches}] Processing ${batch.length} items (${completedItems} done, ${failedItems} failed)...`,
      );

      const results = await Promise.all(
        batch.map(async ({ year, term, subject }) => {
          const termId = `${year}-${term}`;

          try {
            const url = `${CONFIG.CISAPI_BASE}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;
            const xml = await robustFetch(url);
            const parsed = await parseSubjectCascadeXmlFromString(xml);
            const snapshot = fromSubjectCascade(parsed, year, term);
            const sqlStatements = args.dryRun
              ? []
              : subjectSnapshotSqlStatements(snapshot);

            return {
              year,
              term,
              termId: snapshot.termId,
              subject,
              success: true,
              coursesCount: snapshot.courses.length,
              sectionsCount: snapshot.courses.reduce(
                (acc, course) => acc + course.sections.length,
                0,
              ),
              sqlStatements,
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
              error: String(error),
            };
          }
        }),
      );

      // Output results and accumulate stats
      let batchSuccess = 0;
      let batchFailed = 0;
      for (const result of results) {
        if (result.success) {
          for (const sql of result.sqlStatements) {
            writeSql(sql);
          }

          if (!args.dryRun) {
            checkpointStore.markCompleted(result, {
              termId: result.termId,
              courses: result.coursesCount,
              sections: result.sectionsCount,
            });
          }

          // Accumulate per-term stats
          const existing = termResults.get(result.termId) || {
            courses: 0,
            sections: 0,
            subjects: 0,
          };
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

      if (!args.dryRun) {
        const sqlOutput = flushSql();
        if (!sqlOutput) {
          throw new Error("[CHECKPOINT] Cannot save progress without an open SQL artifact");
        }
        checkpointStore.save(checkpointScope, sqlOutput);
      }

      writeLog(
        `[BATCH ${batchNum}/${totalBatches}] Complete: ${batchSuccess} succeeded, ${batchFailed} failed`,
      );
    }

    // Copy termResults to stats
    for (const [termId, termStats] of termResults) {
      stats.termStats.set(termId, termStats);
    }

    if (stats.failedSubjects.length > 0 && !args.allowPartialOutput) {
      printSummary();
      await closeFileWriters();
      throw new Error(
        `Historical sync failed for ${stats.failedSubjects.length} subject(s). Re-run the same command to retry them, or use --allow-partial-output to accept partial SQL output.`,
      );
    }

    if (!args.dryRun) {
      writeTermStateSql(termResults);
      writeSql("COMMIT;");
    }

    // Print comprehensive summary
    printSummary();

    // Close file writers
    await closeFileWriters();

  } finally {
    await closeFileWriters();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runHistoricalSyncCli().catch((error) => {
    console.error(`\n[FATAL ERROR] ${error}`);
    process.exit(1);
  });
}
