import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  buildFeedbackCandidateReport,
  parseFeedbackExport,
  parseFeedbackResolutionLedger,
  type FeedbackCandidateResolution,
} from './feedback-corpus-candidates.js';

const execFileAsync = promisify(execFile);

type Args = {
  database: string;
  limit: number;
  output?: string;
  candidatesOutput?: string;
  outputDir: string;
  remote: boolean;
  noCandidates: boolean;
  resolutions?: string | null;
};

export type FeedbackExportPaths = {
  exportPath: string;
  candidatesPath?: string;
};

const DEFAULT_DATABASE = 'course-search-db-staging';
const DEFAULT_OUTPUT_DIR = 'artifacts/feedback';
const DEFAULT_RESOLUTIONS_PATH = 'docs/feedback-triage-resolutions.json';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const WRANGLER_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

function usage(): string {
  return [
    'Feedback export and triage',
    '',
    'Usage:',
    '  npm run feedback:export -- [--database course-search-db-staging] [--limit 200] [--output <path>] [--candidates-output <path>] [--resolutions <path>]',
    '',
    'Defaults to remote staging D1 and writes timestamped artifacts under artifacts/feedback.',
    `Reviewed candidate resolutions are applied from ${DEFAULT_RESOLUTIONS_PATH} by default.`,
    'Use --local to omit Wrangler --remote for local D1 inspection.',
    'Use --no-candidates to export raw feedback without generating candidate triage JSON.',
    'Use --no-resolutions to inspect raw candidate status without the reviewed-resolution ledger.',
  ].join('\n');
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    database: DEFAULT_DATABASE,
    limit: DEFAULT_LIMIT,
    outputDir: DEFAULT_OUTPUT_DIR,
    remote: true,
    noCandidates: false,
    resolutions: DEFAULT_RESOLUTIONS_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--database' && next) {
      args.database = next;
      i += 1;
    } else if (arg === '--limit' && next) {
      args.limit = parseLimit(next);
      i += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      i += 1;
    } else if (arg === '--candidates-output' && next) {
      args.candidatesOutput = next;
      i += 1;
    } else if (arg === '--output-dir' && next) {
      args.outputDir = next;
      i += 1;
    } else if (arg === '--local') {
      args.remote = false;
    } else if (arg === '--remote') {
      args.remote = true;
    } else if (arg === '--no-candidates') {
      args.noCandidates = true;
    } else if (arg === '--resolutions' && next) {
      args.resolutions = next;
      i += 1;
    } else if (arg === '--no-resolutions') {
      args.resolutions = null;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
  }

  if (!args.database.trim()) {
    throw new Error('--database must not be empty');
  }

  return args;
}

export function resolveFeedbackExportPaths(args: Args, now = new Date()): FeedbackExportPaths {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const baseName = `feedback-events-${stamp}`;
  const exportPath = args.output ?? path.join(args.outputDir, `${baseName}.json`);

  return {
    exportPath,
    candidatesPath: args.noCandidates
      ? undefined
      : args.candidatesOutput ?? path.join(args.outputDir, `${baseName}-candidates.json`),
  };
}

export function buildFeedbackExportCommand(args: Args): { command: string; args: string[] } {
  return {
    command: 'npx',
    args: [
      'wrangler',
      'd1',
      'execute',
      args.database,
      ...(args.remote ? ['--remote'] : []),
      '--json',
      '--command',
      buildFeedbackExportSql(args.limit),
    ],
  };
}

export function buildFeedbackExportSql(limit: number): string {
  const boundedLimit = parseLimit(String(limit));
  return [
    'SELECT',
    'id, kind, issue, page, query, course_id, subject, number, term, year, crn, instructor_name, score_field, expected, message, metadata, created_at',
    'FROM feedback_events',
    'ORDER BY created_at DESC',
    `LIMIT ${boundedLimit}`,
  ].join(' ');
}

export async function writeFeedbackArtifacts(
  rawExport: string,
  source: string,
  paths: FeedbackExportPaths,
  now = new Date(),
  resolutionsPath: string | null = DEFAULT_RESOLUTIONS_PATH
): Promise<{ rowCount: number; candidateCount: number }> {
  await mkdir(path.dirname(paths.exportPath), { recursive: true });
  await writeFile(paths.exportPath, rawExport.endsWith('\n') ? rawExport : `${rawExport}\n`);

  const rows = parseFeedbackExport(rawExport);
  if (!paths.candidatesPath) {
    return { rowCount: rows.length, candidateCount: 0 };
  }

  const resolutions = await loadFeedbackResolutions(resolutionsPath);
  const report = buildFeedbackCandidateReport(rows, source, now, resolutions);
  await mkdir(path.dirname(paths.candidatesPath), { recursive: true });
  await writeFile(paths.candidatesPath, `${JSON.stringify(report, null, 2)}\n`);

  return { rowCount: rows.length, candidateCount: report.needs_review_count };
}

async function loadFeedbackResolutions(pathname: string | null): Promise<FeedbackCandidateResolution[]> {
  if (!pathname) return [];

  try {
    return parseFeedbackResolutionLedger(await readFile(pathname, 'utf8'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new Error(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const paths = resolveFeedbackExportPaths(args);
  const command = buildFeedbackExportCommand(args);
  const { stdout } = await execFileAsync(command.command, command.args, {
    cwd: process.cwd(),
    maxBuffer: WRANGLER_MAX_BUFFER_BYTES,
  });
  const summary = await writeFeedbackArtifacts(stdout, paths.exportPath, paths, new Date(), args.resolutions);

  console.log(`Feedback export written: ${paths.exportPath}`);
  if (paths.candidatesPath) {
    console.log(`Feedback candidates written: ${paths.candidatesPath}`);
  }
  console.log(`Rows: ${summary.rowCount}`);
  console.log(`Candidates needing review: ${summary.candidateCount}`);

  if (summary.rowCount === 0) {
    console.log('No feedback rows found.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string') {
      console.error(error.stderr);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
