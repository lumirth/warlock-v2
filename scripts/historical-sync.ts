#!/usr/bin/env npx tsx
import { pathToFileURL } from 'url';
import {
  chooseSqlOutputPlan,
  courseGenedSqlStatements,
  escapeSQL,
  historicalSyncUsage,
  makeCourseId,
  parseHistoricalSyncArgs,
  runHistoricalSyncCli,
} from './workflows/historical-sync-workflow.ts';

export {
  chooseSqlOutputPlan,
  courseGenedSqlStatements,
  escapeSQL,
  historicalSyncUsage,
  makeCourseId,
  parseHistoricalSyncArgs,
  runHistoricalSyncCli,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistoricalSyncCli().catch(error => {
    console.error(`\n[FATAL ERROR] ${error}`);
    process.exit(1);
  });
}
