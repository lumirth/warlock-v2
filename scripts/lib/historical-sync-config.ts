export const HISTORICAL_SYNC_CONFIG = {
  CISAPI_BASE: 'https://courses.illinois.edu/cisapp/explorer',
  FRONTEND_BASE: 'https://courses.illinois.edu',
  MAX_CONCURRENT: 50,
  BATCH_SIZE: 500,
  RATE_LIMIT_WINDOW_MS: 10 * 60 * 1000,
  RATE_LIMIT_BUFFER_MS: 15 * 1000,
  NETWORK_TIMEOUT_MS: 30000,
  START_YEAR: 2004,
  CHECKPOINT_FILE: 'historical-sync-checkpoint.json',
} as const;

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

export type HistoricalSyncParseResult = HistoricalSyncArgs | { kind: 'help'; usage: string };

export function historicalSyncUsage(currentYear = new Date().getFullYear()): string {
  return `
Historical Sync Script

Usage:
  npx tsx scripts/historical-sync.ts [options]

Options:
  --start-year=YYYY  Start year (default: ${HISTORICAL_SYNC_CONFIG.START_YEAR})
  --end-year=YYYY    End year (default: ${currentYear})
  --term=TERM        Only sync specific term (e.g., spring, fall, summer, winter)
  --sql-file=PATH    SQL output file (default: historical-data.sql)
  --log-file=PATH    Log output file (default: historical-sync.log)
  --dry-run          Don't output SQL, just show what would be synced
  --fresh            Clear resumable progress and start fresh (ignored by --dry-run)
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

  let startYear: number = HISTORICAL_SYNC_CONFIG.START_YEAR;
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

  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (!sqlFile) {
    sqlFile = `historical-data-${timestamp}.sql`;
  }
  if (!logFile) {
    logFile = `historical-sync-${timestamp}.log`;
  }

  return { startYear, endYear, termFilter, dryRun, fresh, allowPartialOutput, sqlFile, logFile };
}

export function isHistoricalSyncHelp(
  result: HistoricalSyncParseResult,
): result is Extract<HistoricalSyncParseResult, { kind: 'help' }> {
  return (result as { kind?: string }).kind === 'help';
}
