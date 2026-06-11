#!/usr/bin/env npx tsx
import { pathToFileURL } from 'url';
import { runHistoricalSyncCli } from './workflows/historical-sync-workflow.ts';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistoricalSyncCli().catch(error => {
    console.error(`\n[FATAL ERROR] ${error}`);
    process.exit(1);
  });
}
