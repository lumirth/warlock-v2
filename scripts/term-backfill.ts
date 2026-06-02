import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateD1BackupEvidence, type D1BackupEvidenceArgs } from './lib/d1-backup-evidence.ts';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
const STATUSES = ['registrable', 'active', 'historical'] as const;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 20;
const DEFAULT_DATABASE = 'course-search-db-staging';
const DEFAULT_MAX_PAGE_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

type Term = typeof TERMS[number];
type TermStatus = typeof STATUSES[number];
type Fetcher = (request: Request) => Promise<Response>;
type Sleeper = (ms: number) => Promise<void>;

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
};

type SyncPagination = {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type TermSyncResponse = {
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
    '  --force-running-locks   Override fresh running subject locks for a deliberate operator rerun.',
    '  --output <path>         Write JSON plus sibling .md report.',
    `  --database <name>       D1 database name for backup evidence. Default: ${DEFAULT_DATABASE}`,
    '  --dry-run               Print the first planned request without mutating staging.',
  ].join('\n');
}

function parseIntArg(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

function parseEnumArg<T extends string>(value: string | undefined, name: string, allowed: readonly T[]): T {
  if (!value || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
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
      args.year = parseIntArg(next, '--year');
      i += 1;
    } else if (arg === '--term') {
      args.term = parseEnumArg(next.toLowerCase(), '--term', TERMS);
      i += 1;
    } else if (arg === '--status') {
      args.status = parseEnumArg(next.toLowerCase(), '--status', STATUSES);
      i += 1;
    } else if (arg === '--page-size') {
      args.pageSize = parseIntArg(next, '--page-size');
      i += 1;
    } else if (arg === '--start-offset') {
      args.startOffset = parseIntArg(next, '--start-offset');
      i += 1;
    } else if (arg === '--max-pages') {
      args.maxPages = parseIntArg(next, '--max-pages');
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
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS_CODES.has(status);
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
  options: {
    maxAttempts: number;
    retryDelayMs: number;
    sleep: Sleeper;
  }
): Promise<TermSyncResponse> {
  const url = endpoint(
    baseUrl,
    `admin/sync/${args.year}/${args.term}?offset=${offset}&limit=${args.pageSize}&status=${args.status}${args.forceRunningLocks ? '&force=true' : ''}`
  );

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const response = await fetcher(new Request(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }));
    const body = await response.json().catch(() => null) as TermSyncResponse | null;

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

    if (!isTransientStatus(response.status) || attempt === options.maxAttempts) {
      throw new Error(`Backfill page ${offset} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
    }

    await options.sleep(options.retryDelayMs * 2 ** (attempt - 1));
  }

  throw new Error(`Backfill page ${offset} failed after ${options.maxAttempts} attempts`);
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
  } = {}
): Promise<BackfillReport> {
  validateBackfillArgs(args);
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? ((request: Request) => fetch(request));
  const validateBackupEvidence = options.validateBackupEvidence ?? validateD1BackupEvidence;
  const sleeper = options.sleep ?? sleep;
  const maxPageAttempts = options.maxPageAttempts ?? DEFAULT_MAX_PAGE_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
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

  let offset = args.startOffset;
  while (true) {
    const body = await postSyncPage(fetcher, baseUrl, adminToken, args, offset, {
      maxAttempts: maxPageAttempts,
      retryDelayMs,
      sleep: sleeper,
    });
    const page = pageFromResponse(offset, args.pageSize, body);
    report.pages.push(page);
    report.totals.successfulSubjects += page.successfulSubjects;
    report.totals.failedSubjects += page.failedSubjects;
    report.totals.skippedSubjects += page.skippedSubjects;
    report.totals.courses += page.totalCourses;
    report.totals.sections += page.totalSections;
    report.totals.rateLimitHits += page.rateLimitHits;

    const nextOffset = body.pagination
      ? body.pagination.offset + body.pagination.limit
      : offset + args.pageSize;
    report.next_offset = page.hasMore ? nextOffset : null;

    if (!page.hasMore) {
      break;
    }
    if (args.maxPages !== undefined && report.pages.length >= args.maxPages) {
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
    const report = await runTermBackfill(args);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
