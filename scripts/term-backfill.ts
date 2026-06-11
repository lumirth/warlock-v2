import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runCli } from './lib/run-cli.ts';
import { validateD1BackupEvidence, type D1BackupEvidenceArgs } from './lib/d1-backup-evidence.ts';
import {
  SEARCH_TERM_VALUES,
  TERM_STATUS_VALUES,
} from '@uiuc-course-search/query-types';
import { type Term, type TermStatus } from './lib/term-model.ts';
import { endpoint, parseEnumArg, parseNonNegativeInt } from './lib/script-args.ts';

const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 20;
const DEFAULT_DATABASE = 'course-search-db-staging';
const DEFAULT_MAX_PAGE_ATTEMPTS = 8;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const DEFAULT_PAGE_TIMEOUT_MS = 120_000;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

type Fetcher = (request: Request) => Promise<Response>;
type Sleeper = (ms: number) => Promise<void>;
type ProgressReporter = (page: BackfillPageResult, report: BackfillReport) => void;

export type { Term, TermStatus };

export type BackfillArgs = {
  year?: number;
  term?: Term;
  status?: TermStatus;
  pageSize: number;
  startOffset: number;
  maxPages?: number;
  dryRun: boolean;
  forceRunningLocks: boolean;
  output?: string;
  database: string;
  backupRef?: string;
  evidenceFile?: string;
  restoreVerified: boolean;
  pageTimeoutMs?: number;
};

type SyncPagination = {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type TermSyncResponse = {
  error?: string;
  termId?: string;
  year?: number;
  term?: string;
  subjectResults?: Array<{ skipped?: boolean }>;
  successfulSubjects?: number;
  failedSubjects?: number;
  totalCourses?: number;
  totalSections?: number;
  rateLimitHits?: number;
  warnings?: string[];
  pagination?: SyncPagination;
};

export type BackfillPageResult = {
  offset: number;
  limit: number;
  successfulSubjects: number;
  failedSubjects: number;
  skippedSubjects: number;
  totalCourses: number;
  totalSections: number;
  rateLimitHits: number;
  hasMore: boolean;
  warnings: string[];
};

export type BackfillReport = {
  generated_at: string;
  base_url: string;
  term_id: string;
  year: number;
  term: Term;
  status: TermStatus;
  dry_run: boolean;
  database: string;
  backup_ref: string | null;
  backup_evidence_file: string | null;
  start_offset: number;
  page_size: number;
  max_pages: number | null;
  pages: BackfillPageResult[];
  totals: {
    successfulSubjects: number;
    failedSubjects: number;
    skippedSubjects: number;
    courses: number;
    sections: number;
    rateLimitHits: number;
  };
  next_offset: number | null;
  stopped_early: boolean;
};

function usage(): string {
  return [
    'Term backfill runner',
    '',
    'Required:',
    '  --year <YYYY>',
    '  --term <winter|spring|summer|fall>',
    '  --status <registrable|active|historical>',
    '',
    'Required for non-dry-run remote writes:',
    '  STAGING_API_BASE_URL=...',
    '  STAGING_ADMIN_TOKEN=...',
    '  --backup-ref <YYYYMMDDTHHMMSSZ>',
    '  --evidence-file <verified D1 backup evidence markdown>',
    '  --restore-verified',
    '',
    'Options:',
    `  --page-size <1-${MAX_PAGE_SIZE}>       Subject page size. Default: ${DEFAULT_PAGE_SIZE}`,
    '  --start-offset <n>      Resume at a subject offset. Default: 0',
    '  --max-pages <n>         Stop after n pages.',
    `  --page-timeout-ms <n>   Abort a stalled admin page request. Default: ${DEFAULT_PAGE_TIMEOUT_MS}`,
    '  --force-running-locks   Override fresh running subject locks for a deliberate operator rerun.',
    '  --output <path>         Write JSON plus sibling .md report.',
    `  --database <name>       D1 database name for backup evidence. Default: ${DEFAULT_DATABASE}`,
    '  --dry-run               Print the first planned request without mutating staging.',
  ].join('\n');
}

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {
    pageSize: DEFAULT_PAGE_SIZE,
    startOffset: 0,
    dryRun: false,
    forceRunningLocks: false,
    database: DEFAULT_DATABASE,
    restoreVerified: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--force-running-locks') {
      args.forceRunningLocks = true;
      continue;
    }
    if (arg === '--restore-verified') {
      args.restoreVerified = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next) continue;

    if (arg === '--year') {
      args.year = parseNonNegativeInt(next, '--year');
      i += 1;
    } else if (arg === '--term') {
      args.term = parseEnumArg(next.toLowerCase(), '--term', SEARCH_TERM_VALUES);
      i += 1;
    } else if (arg === '--status') {
      args.status = parseEnumArg(next.toLowerCase(), '--status', TERM_STATUS_VALUES);
      i += 1;
    } else if (arg === '--page-size') {
      args.pageSize = parseNonNegativeInt(next, '--page-size');
      i += 1;
    } else if (arg === '--start-offset') {
      args.startOffset = parseNonNegativeInt(next, '--start-offset');
      i += 1;
    } else if (arg === '--max-pages') {
      args.maxPages = parseNonNegativeInt(next, '--max-pages');
      i += 1;
    } else if (arg === '--page-timeout-ms') {
      args.pageTimeoutMs = parseNonNegativeInt(next, '--page-timeout-ms');
      i += 1;
    } else if (arg === '--output') {
      args.output = next;
      i += 1;
    } else if (arg === '--database') {
      args.database = next;
      i += 1;
    } else if (arg === '--backup-ref') {
      args.backupRef = next;
      i += 1;
    } else if (arg === '--evidence-file') {
      args.evidenceFile = next;
      i += 1;
    }
  }

  return args;
}

function validateBackfillArgs(args: BackfillArgs): asserts args is BackfillArgs & {
  year: number;
  term: Term;
  status: TermStatus;
} {
  const currentYear = new Date().getFullYear();
  if (!args.year || args.year < 2004 || args.year > currentYear + 2) {
    throw new Error(`--year must be between 2004 and ${currentYear + 2}`);
  }
  if (!args.term) {
    throw new Error('--term is required');
  }
  if (!args.status) {
    throw new Error('--status is required');
  }
  if (args.pageSize < 1 || args.pageSize > MAX_PAGE_SIZE) {
    throw new Error(`--page-size must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (args.maxPages !== undefined && args.maxPages < 1) {
    throw new Error('--max-pages must be at least 1');
  }
  if (args.pageTimeoutMs !== undefined && args.pageTimeoutMs < 1_000) {
    throw new Error('--page-timeout-ms must be at least 1000');
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS_CODES.has(status);
}

function isWorkerInvocationLimit(body: TermSyncResponse | null): boolean {
  return typeof body?.error === 'string'
    && body.error.includes('Too many API requests by single Worker invocation');
}

function isAdaptiveSplitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('timed out')
    || error.message.includes('Too many API requests by single Worker invocation')
    || /HTTP (408|429|500|502|503|504)/.test(error.message);
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pageFromResponse(offset: number, limit: number, body: TermSyncResponse): BackfillPageResult {
  const skippedSubjects = Array.isArray(body.subjectResults)
    ? body.subjectResults.filter(result => result.skipped === true).length
    : 0;
  const warnings = Array.isArray(body.warnings) ? body.warnings.map(String) : [];
  if (skippedSubjects > 0) {
    warnings.push(`${skippedSubjects} subject(s) skipped because a running sync lock was active`);
  }

  return {
    offset,
    limit,
    successfulSubjects: numeric(body.successfulSubjects),
    failedSubjects: numeric(body.failedSubjects),
    skippedSubjects,
    totalCourses: numeric(body.totalCourses),
    totalSections: numeric(body.totalSections),
    rateLimitHits: numeric(body.rateLimitHits),
    hasMore: body.pagination?.hasMore === true,
    warnings,
  };
}

async function postSyncPage(
  fetcher: Fetcher,
  baseUrl: string,
  token: string,
  args: BackfillArgs & { year: number; term: Term; status: TermStatus },
  offset: number,
  limit: number,
  options: {
    maxAttempts: number;
    retryDelayMs: number;
    sleep: Sleeper;
    pageTimeoutMs: number;
  }
): Promise<TermSyncResponse> {
  const url = endpoint(
    baseUrl,
    `admin/sync/${args.year}/${args.term}?offset=${offset}&limit=${limit}&status=${args.status}${args.forceRunningLocks ? '&force=true' : ''}`
  );

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const message = `Backfill page ${offset} timed out after ${options.pageTimeoutMs}ms`;
        controller.abort(message);
        reject(new Error(message));
      }, options.pageTimeoutMs);
    });
    const request = new Request(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    let response: Response;
    let body: TermSyncResponse | null;
    try {
      response = await Promise.race([fetcher(request), timeoutPromise]);
      body = await Promise.race([
        response.json().catch(() => null) as Promise<TermSyncResponse | null>,
        timeoutPromise,
      ]);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.message.includes('timed out'))) {
        throw new Error(`Backfill page ${offset} timed out after ${options.pageTimeoutMs}ms`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }

    if (response.ok) {
      if (attempt > 1) {
        const warnings = Array.isArray(body?.warnings) ? body.warnings : [];
        return {
          ...body,
          warnings: [
            ...warnings,
            `retried transient page failure ${attempt - 1} time(s)`,
          ],
        };
      }
      return body ?? {};
    }

    if (isWorkerInvocationLimit(body) || !isTransientStatus(response.status) || attempt === options.maxAttempts) {
      throw new Error(`Backfill page ${offset} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
    }

    await options.sleep(options.retryDelayMs * 2 ** (attempt - 1));
  }

  throw new Error(`Backfill page ${offset} failed after ${options.maxAttempts} attempts`);
}

function addPageToReport(
  report: BackfillReport,
  page: BackfillPageResult,
  onPage: ProgressReporter | undefined
): void {
  report.pages.push(page);
  report.totals.successfulSubjects += page.successfulSubjects;
  report.totals.failedSubjects += page.failedSubjects;
  report.totals.skippedSubjects += page.skippedSubjects;
  report.totals.courses += page.totalCourses;
  report.totals.sections += page.totalSections;
  report.totals.rateLimitHits += page.rateLimitHits;
  onPage?.(page, report);
}

function nextOffsetFromBody(body: TermSyncResponse, offset: number, limit: number): number {
  return body.pagination
    ? body.pagination.offset + body.pagination.limit
    : offset + limit;
}

function shouldStopForMaxPages(report: BackfillReport, maxPages: number | undefined): boolean {
  return maxPages !== undefined && report.pages.length >= maxPages;
}

function backupArgs(args: BackfillArgs): D1BackupEvidenceArgs {
  return {
    database: args.database,
    backupRef: args.backupRef,
    evidenceFile: args.evidenceFile,
    restoreVerified: args.restoreVerified,
  };
}

export async function runTermBackfill(
  args: BackfillArgs,
  options: {
    env?: NodeJS.ProcessEnv;
    fetcher?: Fetcher;
    validateBackupEvidence?: (args: D1BackupEvidenceArgs) => Promise<void>;
    sleep?: Sleeper;
    maxPageAttempts?: number;
    retryDelayMs?: number;
    onPage?: ProgressReporter;
  } = {}
): Promise<BackfillReport> {
  validateBackfillArgs(args);
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? ((request: Request) => fetch(request));
  const validateBackupEvidence = options.validateBackupEvidence ?? validateD1BackupEvidence;
  const sleeper = options.sleep ?? sleep;
  const maxPageAttempts = options.maxPageAttempts ?? DEFAULT_MAX_PAGE_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const pageTimeoutMs = args.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const baseUrl = args.dryRun ? (env.STAGING_API_BASE_URL ?? 'https://staging.example.invalid') : requiredEnv(env, 'STAGING_API_BASE_URL');
  const adminToken = args.dryRun ? '' : requiredEnv(env, 'STAGING_ADMIN_TOKEN');

  if (!args.dryRun) {
    await validateBackupEvidence(backupArgs(args));
  }

  const report: BackfillReport = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    term_id: `${args.year}-${args.term}`,
    year: args.year,
    term: args.term,
    status: args.status,
    dry_run: args.dryRun,
    database: args.database,
    backup_ref: args.backupRef ?? null,
    backup_evidence_file: args.evidenceFile ?? null,
    start_offset: args.startOffset,
    page_size: args.pageSize,
    max_pages: args.maxPages ?? null,
    pages: [],
    totals: {
      successfulSubjects: 0,
      failedSubjects: 0,
      skippedSubjects: 0,
      courses: 0,
      sections: 0,
      rateLimitHits: 0,
    },
    next_offset: args.startOffset,
    stopped_early: false,
  };

  if (args.dryRun) {
    report.next_offset = args.startOffset + args.pageSize;
    report.pages.push({
      offset: args.startOffset,
      limit: args.pageSize,
      successfulSubjects: 0,
      failedSubjects: 0,
      skippedSubjects: 0,
      totalCourses: 0,
      totalSections: 0,
      rateLimitHits: 0,
      hasMore: true,
      warnings: ['dry run: no remote sync request sent'],
    });
    return report;
  }

  const syncPage = async (
    offset: number,
    limit: number,
    extraWarning?: string
  ): Promise<{ body: TermSyncResponse; page: BackfillPageResult; nextOffset: number }> => {
    const body = await postSyncPage(fetcher, baseUrl, adminToken, args, offset, limit, {
      maxAttempts: maxPageAttempts,
      retryDelayMs,
      sleep: sleeper,
      pageTimeoutMs,
    });
    const page = pageFromResponse(offset, limit, body);
    if (extraWarning) {
      page.warnings.unshift(extraWarning);
    }
    return {
      body,
      page,
      nextOffset: nextOffsetFromBody(body, offset, limit),
    };
  };

  const syncSplitPage = async (offset: number, reason: string): Promise<number | null> => {
    let splitOffset = offset;
    for (let index = 0; index < args.pageSize; index += 1) {
      const split = await syncPage(
        splitOffset,
        1,
        index === 0 ? `adaptive split from offset ${offset} limit ${args.pageSize}: ${reason}` : undefined
      );
      addPageToReport(report, split.page, options.onPage);
      report.next_offset = split.page.hasMore ? split.nextOffset : null;

      if (!split.page.hasMore) {
        return null;
      }
      if (shouldStopForMaxPages(report, args.maxPages)) {
        report.stopped_early = true;
        return split.nextOffset;
      }

      splitOffset = split.nextOffset;
    }

    return splitOffset;
  };

  let offset = args.startOffset;
  while (true) {
    let nextOffset: number | null;
    try {
      const result = await syncPage(offset, args.pageSize);
      if (result.page.failedSubjects > 0 && args.pageSize > 1) {
        nextOffset = await syncSplitPage(offset, `${result.page.failedSubjects} failed subject(s) reported by aggregate page`);
      } else {
        addPageToReport(report, result.page, options.onPage);
        nextOffset = result.page.hasMore ? result.nextOffset : null;
        report.next_offset = nextOffset;
      }
    } catch (error) {
      if (args.pageSize <= 1 || !isAdaptiveSplitError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      nextOffset = await syncSplitPage(offset, message);
    }

    if (nextOffset === null) {
      break;
    }
    if (report.stopped_early || shouldStopForMaxPages(report, args.maxPages)) {
      report.stopped_early = true;
      break;
    }

    offset = nextOffset;
  }

  return report;
}

export function formatTermBackfillReport(report: BackfillReport): string {
  const lines = [
    '# Term Backfill Report',
    '',
    `Generated at: ${report.generated_at}`,
    `Base URL: ${report.base_url}`,
    `Term: ${report.term_id}`,
    `Status: ${report.status}`,
    `Dry run: ${report.dry_run ? 'yes' : 'no'}`,
    `Database: ${report.database}`,
    `Backup ref: ${report.backup_ref ?? 'n/a'}`,
    `Pages: ${report.pages.length}`,
    `Stopped early: ${report.stopped_early ? 'yes' : 'no'}`,
    `Next offset: ${report.next_offset ?? 'complete'}`,
    '',
    '## Totals',
    '',
    `- Successful subjects: ${report.totals.successfulSubjects}`,
    `- Failed subjects: ${report.totals.failedSubjects}`,
    `- Skipped subjects: ${report.totals.skippedSubjects}`,
    `- Courses: ${report.totals.courses}`,
    `- Sections: ${report.totals.sections}`,
    `- Rate-limit hits: ${report.totals.rateLimitHits}`,
    '',
    '## Pages',
    '',
  ];

  for (const page of report.pages) {
    lines.push(`- offset ${page.offset}: ${page.successfulSubjects} subject(s), skipped=${page.skippedSubjects}, ${page.totalCourses} course(s), ${page.totalSections} section(s), hasMore=${page.hasMore}`);
    for (const warning of page.warnings) {
      lines.push(`  - warning: ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeReport(output: string, report: BackfillReport): void {
  mkdirSync(dirname(output), { recursive: true });
  const markdownOutput = /\.json$/i.test(output) ? output.replace(/\.json$/i, '.md') : `${output}.md`;
  writeFileSync(output, JSON.stringify(report, null, 2));
  writeFileSync(markdownOutput, formatTermBackfillReport(report));
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  try {
    const report = await runTermBackfill(args, {
      onPage: (page, partialReport) => {
        const nextOffset = page.hasMore ? page.offset + page.limit : null;
        process.stderr.write([
          `synced ${partialReport.term_id}`,
          `offset=${page.offset}`,
          `subjects=${page.successfulSubjects}`,
          `failed=${page.failedSubjects}`,
          `skipped=${page.skippedSubjects}`,
          `next=${nextOffset ?? 'complete'}`,
        ].join(' ') + '\n');
      },
    });
    if (args.output) {
      writeReport(args.output, report);
    }
    console.log(formatTermBackfillReport(report));
  } catch (error) {
    console.error(usage());
    console.error('');
    throw error;
  }
}

runCli(import.meta.url, main);
