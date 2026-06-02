import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateD1BackupEvidence, type D1BackupEvidenceArgs } from './lib/d1-backup-evidence.ts';
import {
  runTermBackfill,
  type BackfillPageResult,
  type BackfillReport,
  type Term,
  type TermStatus,
} from './term-backfill.ts';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
const STATUSES = ['registrable', 'active', 'historical'] as const;
const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 20;
const DEFAULT_DATABASE = 'course-search-db-staging';

type Fetcher = (request: Request) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export type CoverageBackfillArgs = {
  coveragePlan?: string;
  pageSize: number;
  maxTerms?: number;
  maxPagesPerTerm?: number;
  dryRun: boolean;
  forceRunningLocks: boolean;
  output?: string;
  database: string;
  backupRef?: string;
  evidenceFile?: string;
  restoreVerified: boolean;
};

type CoveragePlanTerm = {
  term_id: string;
  year: number;
  term: Term;
  expected_status: TermStatus;
  reason: string;
  needs_backfill: boolean;
};

type CoveragePlan = {
  terms: CoveragePlanTerm[];
};

type CoverageProgressReporter = {
  onTermStart?: (term: CoveragePlanTerm, index: number, total: number) => void;
  onPage?: (term: CoveragePlanTerm, page: BackfillPageResult) => void;
  onTermComplete?: (term: CoverageBackfillTermReport, index: number, total: number) => void;
};

export type CoverageBackfillTermReport = {
  term_id: string;
  year: number;
  term: Term;
  status: TermStatus;
  reason: string;
  complete: boolean;
  stopped_early: boolean;
  next_offset: number | null;
  totals: BackfillReport['totals'];
  pages: BackfillReport['pages'];
};

export type CoverageBackfillReport = {
  generated_at: string;
  coverage_plan: string | null;
  dry_run: boolean;
  database: string;
  backup_ref: string | null;
  page_size: number;
  max_terms: number | null;
  max_pages_per_term: number | null;
  target_count: number;
  executed_count: number;
  incomplete_count: number;
  failed_subjects: number;
  skipped_subjects: number;
  terms: CoverageBackfillTermReport[];
};

function usage(): string {
  return [
    'Coverage backfill runner',
    '',
    'Required:',
    '  --coverage-plan <artifacts/term-coverage-plan.json>',
    '',
    'Required for non-dry-run remote writes:',
    '  STAGING_API_BASE_URL=...',
    '  STAGING_ADMIN_TOKEN=...',
    '  --backup-ref <YYYYMMDDTHHMMSSZ>',
    '  --evidence-file <verified D1 backup evidence markdown>',
    '  --restore-verified',
    '',
    'Options:',
    `  --page-size <1-${MAX_PAGE_SIZE}>          Subject page size. Default: ${DEFAULT_PAGE_SIZE}`,
    '  --max-terms <n>           Stop after n planned terms.',
    '  --max-pages-per-term <n>  Stop each term after n pages.',
    '  --force-running-locks     Override fresh running subject locks for deliberate operator reruns.',
    '  --output <path>           Write JSON plus sibling .md report.',
    `  --database <name>         D1 database name for backup evidence. Default: ${DEFAULT_DATABASE}`,
    '  --dry-run                 Plan term execution without mutating staging.',
  ].join('\n');
}

function parseIntArg(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

function isTerm(value: unknown): value is Term {
  return typeof value === 'string' && (TERMS as readonly string[]).includes(value.toLowerCase());
}

function isStatus(value: unknown): value is TermStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value.toLowerCase());
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizePlanTerm(value: unknown): CoveragePlanTerm | null {
  const row = asRecord(value);
  if (!row) return null;
  const year = typeof row.year === 'number' && Number.isInteger(row.year) ? row.year : null;
  const term = isTerm(row.term) ? row.term.toLowerCase() as Term : null;
  const status = isStatus(row.expected_status) ? row.expected_status.toLowerCase() as TermStatus : null;
  const termId = typeof row.term_id === 'string' ? row.term_id : year && term ? `${year}-${term}` : null;
  const reason = typeof row.reason === 'string' ? row.reason : 'needs backfill';
  const needsBackfill = row.needs_backfill === true;

  if (!termId || !year || !term || !status) {
    return null;
  }

  return {
    term_id: termId,
    year,
    term,
    expected_status: status,
    reason,
    needs_backfill: needsBackfill,
  };
}

export function parseCoverageBackfillArgs(argv: string[]): CoverageBackfillArgs {
  const args: CoverageBackfillArgs = {
    pageSize: DEFAULT_PAGE_SIZE,
    dryRun: false,
    forceRunningLocks: false,
    database: DEFAULT_DATABASE,
    restoreVerified: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

    const next = argv[index + 1];
    if (!next) continue;

    if (arg === '--coverage-plan') {
      args.coveragePlan = next;
      index += 1;
    } else if (arg === '--page-size') {
      args.pageSize = parseIntArg(next, '--page-size');
      index += 1;
    } else if (arg === '--max-terms') {
      args.maxTerms = parseIntArg(next, '--max-terms');
      index += 1;
    } else if (arg === '--max-pages-per-term') {
      args.maxPagesPerTerm = parseIntArg(next, '--max-pages-per-term');
      index += 1;
    } else if (arg === '--output') {
      args.output = next;
      index += 1;
    } else if (arg === '--database') {
      args.database = next;
      index += 1;
    } else if (arg === '--backup-ref') {
      args.backupRef = next;
      index += 1;
    } else if (arg === '--evidence-file') {
      args.evidenceFile = next;
      index += 1;
    }
  }

  if (args.pageSize < 1 || args.pageSize > MAX_PAGE_SIZE) {
    throw new Error(`--page-size must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (args.maxTerms !== undefined && args.maxTerms < 1) {
    throw new Error('--max-terms must be at least 1');
  }
  if (args.maxPagesPerTerm !== undefined && args.maxPagesPerTerm < 1) {
    throw new Error('--max-pages-per-term must be at least 1');
  }

  return args;
}

async function readCoveragePlan(path: string): Promise<CoveragePlan> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const record = asRecord(raw);
  const rows = Array.isArray(record?.terms)
    ? record.terms.map(normalizePlanTerm).filter((row): row is CoveragePlanTerm => row !== null)
    : [];

  if (!record || !Array.isArray(record.terms)) {
    throw new Error('--coverage-plan must contain a term coverage JSON report');
  }

  return { terms: rows };
}

function backupArgs(args: CoverageBackfillArgs): D1BackupEvidenceArgs {
  return {
    database: args.database,
    backupRef: args.backupRef,
    evidenceFile: args.evidenceFile,
    restoreVerified: args.restoreVerified,
  };
}

function termReport(row: CoveragePlanTerm, report: BackfillReport): CoverageBackfillTermReport {
  return {
    term_id: row.term_id,
    year: row.year,
    term: row.term,
    status: row.expected_status,
    reason: row.reason,
    complete: report.next_offset === null && !report.stopped_early && report.totals.skippedSubjects === 0,
    stopped_early: report.stopped_early,
    next_offset: report.next_offset,
    totals: report.totals,
    pages: report.pages,
  };
}

export async function runCoverageBackfill(
  args: CoverageBackfillArgs,
  options: {
    env?: NodeJS.ProcessEnv;
    fetcher?: Fetcher;
    coveragePlan?: CoveragePlan;
    validateBackupEvidence?: (args: D1BackupEvidenceArgs) => Promise<void>;
    progress?: CoverageProgressReporter;
  } = {}
): Promise<CoverageBackfillReport> {
  if (!args.coveragePlan && !options.coveragePlan) {
    throw new Error('--coverage-plan is required');
  }

  const plan = options.coveragePlan ?? await readCoveragePlan(args.coveragePlan!);
  const targets = plan.terms.filter(row => row.needs_backfill);
  const selected = args.maxTerms === undefined ? targets : targets.slice(0, args.maxTerms);
  const validateBackupEvidence = options.validateBackupEvidence ?? validateD1BackupEvidence;

  if (!args.dryRun) {
    await validateBackupEvidence(backupArgs(args));
  }

  const terms: CoverageBackfillTermReport[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const row = selected[index];
    options.progress?.onTermStart?.(row, index + 1, selected.length);
    const report = await runTermBackfill({
      year: row.year,
      term: row.term,
      status: row.expected_status,
      pageSize: args.pageSize,
      startOffset: 0,
      maxPages: args.maxPagesPerTerm,
      dryRun: args.dryRun,
      forceRunningLocks: args.forceRunningLocks,
      database: args.database,
      backupRef: args.backupRef,
      evidenceFile: args.evidenceFile,
      restoreVerified: args.restoreVerified,
    }, {
      env: options.env,
      fetcher: options.fetcher,
      validateBackupEvidence: async () => {},
      onPage: page => options.progress?.onPage?.(row, page),
    });
    const completedTerm = termReport(row, report);
    terms.push(completedTerm);
    options.progress?.onTermComplete?.(completedTerm, index + 1, selected.length);
  }

  return {
    generated_at: new Date().toISOString(),
    coverage_plan: args.coveragePlan ?? null,
    dry_run: args.dryRun,
    database: args.database,
    backup_ref: args.backupRef ?? null,
    page_size: args.pageSize,
    max_terms: args.maxTerms ?? null,
    max_pages_per_term: args.maxPagesPerTerm ?? null,
    target_count: targets.length,
    executed_count: terms.length,
    incomplete_count: terms.filter(row => !row.complete).length,
    failed_subjects: terms.reduce((total, row) => total + row.totals.failedSubjects, 0),
    skipped_subjects: terms.reduce((total, row) => total + row.totals.skippedSubjects, 0),
    terms,
  };
}

export function formatCoverageBackfillReport(report: CoverageBackfillReport): string {
  const lines = [
    '# Coverage Backfill Report',
    '',
    `Generated at: ${report.generated_at}`,
    `Coverage plan: ${report.coverage_plan ?? 'in-memory'}`,
    `Dry run: ${report.dry_run ? 'yes' : 'no'}`,
    `Database: ${report.database}`,
    `Backup ref: ${report.backup_ref ?? 'n/a'}`,
    `Page size: ${report.page_size}`,
    `Max terms: ${report.max_terms ?? 'all'}`,
    `Max pages per term: ${report.max_pages_per_term ?? 'all'}`,
    `Target terms: ${report.target_count}`,
    `Executed terms: ${report.executed_count}`,
    `Incomplete terms: ${report.incomplete_count}`,
    `Failed subjects: ${report.failed_subjects}`,
    `Skipped subjects: ${report.skipped_subjects}`,
    '',
    '## Terms',
    '',
  ];

  if (report.terms.length === 0) {
    lines.push('No terms required backfill.');
  }

  for (const term of report.terms) {
    lines.push(`- ${term.term_id} (${term.status}): ${term.reason}; pages=${term.pages.length}; next=${term.next_offset ?? 'complete'}; failedSubjects=${term.totals.failedSubjects}; skippedSubjects=${term.totals.skippedSubjects}`);
    for (const page of term.pages) {
      for (const warning of page.warnings) {
        lines.push(`  - warning: ${warning}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function markdownOutputFor(output: string): string {
  return /\.json$/i.test(output) ? output.replace(/\.json$/i, '.md') : `${output}.md`;
}

function writeReport(output: string, report: CoverageBackfillReport): void {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownOutputFor(output), formatCoverageBackfillReport(report));
}

async function main(): Promise<void> {
  const args = parseCoverageBackfillArgs(process.argv.slice(2));
  try {
    const report = await runCoverageBackfill(args, {
      progress: {
        onTermStart: (term, index, total) => {
          process.stderr.write(`term ${index}/${total} start ${term.term_id} status=${term.expected_status}\n`);
        },
        onPage: (term, page) => {
          const nextOffset = page.hasMore ? page.offset + page.limit : null;
          process.stderr.write([
            `term ${term.term_id}`,
            `offset=${page.offset}`,
            `subjects=${page.successfulSubjects}`,
            `failed=${page.failedSubjects}`,
            `skipped=${page.skippedSubjects}`,
            `next=${nextOffset ?? 'complete'}`,
          ].join(' ') + '\n');
        },
        onTermComplete: (term, index, total) => {
          process.stderr.write([
            `term ${index}/${total} done ${term.term_id}`,
            `complete=${term.complete ? 'yes' : 'no'}`,
            `failedSubjects=${term.totals.failedSubjects}`,
            `skippedSubjects=${term.totals.skippedSubjects}`,
            `next=${term.next_offset ?? 'complete'}`,
          ].join(' ') + '\n');
        },
      },
    });
    if (args.output) {
      writeReport(args.output, report);
    }
    process.stdout.write(formatCoverageBackfillReport(report));

    const intentionallyBounded = args.dryRun || args.maxTerms !== undefined || args.maxPagesPerTerm !== undefined;
    if (!intentionallyBounded && (report.incomplete_count > 0 || report.failed_subjects > 0 || report.skipped_subjects > 0)) {
      process.exitCode = 1;
    }
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
