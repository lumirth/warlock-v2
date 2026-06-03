import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  buildTermCoverageReport,
  formatTermCoverageReport,
  type TermCoverageReport,
} from './term-coverage-plan.js';
import {
  auditFreshnessStatus,
  formatFreshnessAuditReport,
  type FreshnessAuditReport,
} from './data-freshness-audit.js';
import {
  buildFeedbackExportCommand,
  resolveFeedbackExportPaths,
  writeFeedbackArtifacts,
} from './export-feedback.js';
import {
  buildTermRetentionReport,
  formatTermRetentionReport,
  type TermRetentionReport,
} from './term-retention-plan.js';

const execFileAsync = promisify(execFile);

const DEFAULT_FRONTEND_BASE = 'https://courses.illinois.edu';
const DEFAULT_FROM_YEAR = 2004;
const DEFAULT_TARGET_SIZE_MB = 250;
const DEFAULT_FEEDBACK_DATABASE = 'course-search-db-staging';
const DEFAULT_FEEDBACK_LIMIT = 200;
const WRANGLER_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

type Fetcher = (request: Request) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type CommandRunner = (command: string, args: string[]) => Promise<string>;

export type SemesterMaintenanceArgs = {
  outputDir?: string;
  statusInput?: string;
  apiBaseUrl?: string;
  adminToken?: string;
  fromYear: number;
  toYear: number;
  frontendBase: string;
  targetSizeMb: number;
  maxRetainedTerms?: number;
  noFeedback: boolean;
  feedbackDatabase: string;
  feedbackLimit: number;
  feedbackRemote: boolean;
  requireRmp: boolean;
};

export type SemesterMaintenanceArtifactPaths = {
  status: string;
  retention: string;
  retentionMarkdown: string;
  retentionPruneSql: string;
  coverage: string;
  coverageMarkdown: string;
  freshness: string;
  freshnessMarkdown: string;
  feedbackExport?: string;
  feedbackCandidates?: string;
  summary: string;
};

export type SemesterMaintenanceGate = {
  name: string;
  ok: boolean;
  detail: string;
};

export type SemesterMaintenanceReport = {
  generated_at: string;
  output_dir: string;
  status_source: string;
  artifacts: SemesterMaintenanceArtifactPaths;
  counts: {
    retained_terms: number;
    dropped_terms: number;
    coverage_terms_needing_backfill: number;
    freshness_failed_checks: number;
    feedback_rows: number | null;
    feedback_candidates: number | null;
  };
  backup_required_before_prune: boolean;
  gates: SemesterMaintenanceGate[];
  next_actions: string[];
};

type LoadedStatus = {
  source: string;
  status: JsonRecord;
};

type RunOptions = {
  fetcher?: Fetcher;
  commandRunner?: CommandRunner;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

function usage(): string {
  return [
    'Semester maintenance plan',
    '',
    'Usage:',
    '  npm run data:semester:plan -- [--status-input artifacts/sync-status.json] [--output-dir artifacts/semester-maintenance/<stamp>]',
    '  STAGING_API_BASE_URL=... STAGING_ADMIN_TOKEN=... npm run data:semester:plan',
    '',
    'Options:',
    '  --from-year <year>              Discovery horizon start. Default: 2004',
    '  --to-year <year>                Discovery horizon end. Default: current year + 1',
    '  --frontend-base <url>           Course Explorer base URL.',
    '  --target-size-mb <mb>           Rolling full-detail D1 target. Default: 250',
    '  --max-retained-terms <n>        Optional retained-term cap for what-if plans.',
    '  --no-feedback                  Skip read-only feedback D1 export.',
    '  --feedback-database <name>     D1 database for feedback export. Default: course-search-db-staging',
    '  --feedback-limit <n>            Feedback row limit. Default: 200',
    '  --feedback-local               Omit Wrangler --remote for feedback export.',
    '  --no-require-rmp               Do not fail freshness when RMP state is absent or stale.',
  ].join('\n');
}

export function parseSemesterMaintenanceArgs(argv: string[]): SemesterMaintenanceArgs {
  const currentYear = new Date().getFullYear();
  const args: SemesterMaintenanceArgs = {
    fromYear: DEFAULT_FROM_YEAR,
    toYear: currentYear + 1,
    frontendBase: DEFAULT_FRONTEND_BASE,
    targetSizeMb: DEFAULT_TARGET_SIZE_MB,
    noFeedback: false,
    feedbackDatabase: DEFAULT_FEEDBACK_DATABASE,
    feedbackLimit: DEFAULT_FEEDBACK_LIMIT,
    feedbackRemote: true,
    requireRmp: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--output-dir' && next) {
      args.outputDir = next;
      index += 1;
    } else if (arg === '--status-input' && next) {
      args.statusInput = next;
      index += 1;
    } else if (arg === '--api-base-url' && next) {
      args.apiBaseUrl = next;
      index += 1;
    } else if (arg === '--admin-token' && next) {
      args.adminToken = next;
      index += 1;
    } else if (arg === '--from-year' && next) {
      args.fromYear = parseNonNegativeInteger(next, '--from-year');
      index += 1;
    } else if (arg === '--to-year' && next) {
      args.toYear = parseNonNegativeInteger(next, '--to-year');
      index += 1;
    } else if (arg === '--frontend-base' && next) {
      args.frontendBase = next;
      index += 1;
    } else if (arg === '--target-size-mb' && next) {
      args.targetSizeMb = parseNonNegativeNumber(next, '--target-size-mb');
      index += 1;
    } else if (arg === '--max-retained-terms' && next) {
      args.maxRetainedTerms = parseNonNegativeInteger(next, '--max-retained-terms');
      index += 1;
    } else if (arg === '--no-feedback') {
      args.noFeedback = true;
    } else if (arg === '--feedback-database' && next) {
      args.feedbackDatabase = next;
      index += 1;
    } else if (arg === '--feedback-limit' && next) {
      args.feedbackLimit = parseBoundedInteger(next, '--feedback-limit', 1, 1000);
      index += 1;
    } else if (arg === '--feedback-local') {
      args.feedbackRemote = false;
    } else if (arg === '--feedback-remote') {
      args.feedbackRemote = true;
    } else if (arg === '--no-require-rmp') {
      args.requireRmp = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
  }

  if (args.fromYear > args.toYear) {
    throw new Error('--from-year must be less than or equal to --to-year');
  }
  if (args.maxRetainedTerms !== undefined && args.maxRetainedTerms < 1) {
    throw new Error('--max-retained-terms must be at least 1');
  }
  if (!args.feedbackDatabase.trim()) {
    throw new Error('--feedback-database must not be empty');
  }

  return args;
}

export async function runSemesterMaintenancePlan(
  args: SemesterMaintenanceArgs,
  options: RunOptions = {}
): Promise<SemesterMaintenanceReport> {
  const now = options.now ?? new Date();
  const outputDir = args.outputDir ?? path.join('artifacts', 'semester-maintenance', timestamp(now));
  const paths = artifactPaths(outputDir);
  const loadedStatus = await loadSyncStatus(args, options);

  await mkdir(outputDir, { recursive: true });
  await writeJson(paths.status, loadedStatus.status);

  const retention = await buildTermRetentionReport({
    fromYear: args.fromYear,
    toYear: args.toYear,
    frontendBase: args.frontendBase,
    statusInput: paths.status,
    output: paths.retention,
    targetSizeMb: args.targetSizeMb,
    maxRetainedTerms: args.maxRetainedTerms,
  }, {
    fetcher: options.fetcher,
    status: loadedStatus.status,
    statusSource: paths.status,
    now,
  });
  await writeRetentionArtifacts(paths, retention);

  const coverage = await buildTermCoverageReport({
    fromYear: args.fromYear,
    toYear: args.toYear,
    frontendBase: args.frontendBase,
    statusInput: paths.status,
    retentionInput: paths.retention,
    output: paths.coverage,
  }, {
    fetcher: options.fetcher,
    status: loadedStatus.status,
    statusSource: paths.status,
    retention,
    retentionSource: paths.retention,
    now,
  });
  await writeCoverageArtifacts(paths, coverage);

  const freshness = buildFreshnessReport(paths, loadedStatus.status, retention, args.requireRmp, now);
  await writeFreshnessArtifacts(paths, freshness);

  const feedbackSummary = await runFeedbackExport(args, paths, now, options.commandRunner);
  const report = buildMaintenanceReport({
    now,
    outputDir,
    statusSource: loadedStatus.source,
    paths,
    retention,
    coverage,
    freshness,
    feedbackRows: feedbackSummary.rows,
    feedbackCandidates: feedbackSummary.candidates,
    feedbackError: feedbackSummary.error,
  });

  await writeFile(paths.summary, formatSemesterMaintenanceReport(report));
  return report;
}

export function formatSemesterMaintenanceReport(report: SemesterMaintenanceReport): string {
  const failed = report.gates.filter(gate => !gate.ok);
  const lines = [
    '# Semester Maintenance Plan',
    '',
    `Generated at: ${report.generated_at}`,
    `Output directory: ${report.output_dir}`,
    `Status source: ${report.status_source}`,
    '',
    '## Artifacts',
    '',
    `- Sync status: ${report.artifacts.status}`,
    `- Term retention: ${report.artifacts.retention}`,
    `- Prune SQL: ${report.artifacts.retentionPruneSql}`,
    `- Term coverage: ${report.artifacts.coverage}`,
    `- Freshness audit: ${report.artifacts.freshness}`,
    `- Feedback export: ${report.artifacts.feedbackExport ?? 'skipped'}`,
    `- Feedback candidates: ${report.artifacts.feedbackCandidates ?? 'skipped'}`,
    '',
    '## Counts',
    '',
    `- Retained terms: ${report.counts.retained_terms}`,
    `- Dropped terms: ${report.counts.dropped_terms}`,
    `- Coverage terms needing backfill: ${report.counts.coverage_terms_needing_backfill}`,
    `- Freshness failed checks: ${report.counts.freshness_failed_checks}`,
    `- Feedback rows: ${report.counts.feedback_rows ?? 'skipped'}`,
    `- Feedback candidates: ${report.counts.feedback_candidates ?? 'skipped'}`,
    `- Backup required before prune: ${report.backup_required_before_prune ? 'yes' : 'no'}`,
    '',
    '## Gates',
    '',
  ];

  for (const gate of report.gates) {
    lines.push(`- ${gate.ok ? 'PASS' : 'FAIL'} ${gate.name}: ${gate.detail}`);
  }

  lines.push('', '## Next Actions', '');
  if (report.next_actions.length === 0) {
    lines.push('No operator action required by this maintenance plan.');
  } else {
    for (const action of report.next_actions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push('', `Overall: ${failed.length === 0 ? 'ready' : 'needs operator action'}`);
  return `${lines.join('\n')}\n`;
}

function parseNonNegativeInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

function parseNonNegativeNumber(value: string, name: string): number {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return Number.parseFloat(value);
}

function parseBoundedInteger(value: string, name: string, min: number, max: number): number {
  const parsed = parseNonNegativeInteger(value, name);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function artifactPaths(outputDir: string): SemesterMaintenanceArtifactPaths {
  return {
    status: path.join(outputDir, 'sync-status.json'),
    retention: path.join(outputDir, 'term-retention-plan.json'),
    retentionMarkdown: path.join(outputDir, 'term-retention-plan.md'),
    retentionPruneSql: path.join(outputDir, 'term-retention-prune.sql'),
    coverage: path.join(outputDir, 'term-coverage-plan.json'),
    coverageMarkdown: path.join(outputDir, 'term-coverage-plan.md'),
    freshness: path.join(outputDir, 'data-freshness-audit.json'),
    freshnessMarkdown: path.join(outputDir, 'data-freshness-audit.md'),
    feedbackExport: path.join(outputDir, 'feedback-events.json'),
    feedbackCandidates: path.join(outputDir, 'feedback-candidates.json'),
    summary: path.join(outputDir, 'semester-maintenance-plan.md'),
  };
}

async function loadSyncStatus(args: SemesterMaintenanceArgs, options: RunOptions): Promise<LoadedStatus> {
  if (args.statusInput) {
    const parsed = asRecord(JSON.parse(await readFile(args.statusInput, 'utf8')));
    if (!parsed) {
      throw new Error('--status-input must contain a JSON object from /admin/sync/status');
    }
    return { source: args.statusInput, status: parsed };
  }

  const env = options.env ?? process.env;
  const apiBaseUrl = args.apiBaseUrl ?? env.STAGING_API_BASE_URL;
  const adminToken = args.adminToken ?? env.STAGING_ADMIN_TOKEN;
  if (!apiBaseUrl || !adminToken) {
    console.error(usage());
    throw new Error('Provide --status-input or STAGING_API_BASE_URL and STAGING_ADMIN_TOKEN');
  }

  const url = new URL('admin/sync/status', apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`);
  const fetcher = options.fetcher ?? (request => fetch(request));
  const response = await fetcher(new Request(url, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }));
  if (!response.ok) {
    throw new Error(`sync status request failed: ${response.status} ${response.statusText}`);
  }
  const parsed = asRecord(await response.json());
  if (!parsed) {
    throw new Error('sync status response must be a JSON object');
  }
  return { source: url.toString(), status: parsed };
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeRetentionArtifacts(paths: SemesterMaintenanceArtifactPaths, report: TermRetentionReport): Promise<void> {
  await writeJson(paths.retention, report);
  await writeFile(paths.retentionMarkdown, formatTermRetentionReport(report));
  await writeFile(paths.retentionPruneSql, report.prune_sql);
}

async function writeCoverageArtifacts(paths: SemesterMaintenanceArtifactPaths, report: TermCoverageReport): Promise<void> {
  await writeJson(paths.coverage, report);
  await writeFile(paths.coverageMarkdown, formatTermCoverageReport(report));
}

function buildFreshnessReport(
  paths: SemesterMaintenanceArtifactPaths,
  status: JsonRecord,
  retention: TermRetentionReport,
  requireRmp: boolean,
  now: Date
): FreshnessAuditReport {
  return {
    generated_at: now.toISOString(),
    source: paths.status,
    retention_source: paths.retention,
    checks: auditFreshnessStatus(status, {
      requireRmp,
      retentionPlan: {
        retainedTermIds: retention.retained_term_ids,
        droppedTermIds: retention.dropped_term_ids,
      },
    }),
  };
}

async function writeFreshnessArtifacts(paths: SemesterMaintenanceArtifactPaths, report: FreshnessAuditReport): Promise<void> {
  await writeJson(paths.freshness, report);
  await writeFile(paths.freshnessMarkdown, formatFreshnessAuditReport(report));
}

async function runFeedbackExport(
  args: SemesterMaintenanceArgs,
  paths: SemesterMaintenanceArtifactPaths,
  now: Date,
  commandRunner?: CommandRunner
): Promise<{ rows: number | null; candidates: number | null; error: string | null }> {
  if (args.noFeedback) {
    paths.feedbackExport = undefined;
    paths.feedbackCandidates = undefined;
    return { rows: null, candidates: null, error: null };
  }

  const feedbackPaths = resolveFeedbackExportPaths({
    database: args.feedbackDatabase,
    limit: args.feedbackLimit,
    output: paths.feedbackExport,
    candidatesOutput: paths.feedbackCandidates,
    outputDir: path.dirname(paths.feedbackExport ?? paths.summary),
    remote: args.feedbackRemote,
    noCandidates: false,
  }, now);
  paths.feedbackExport = feedbackPaths.exportPath;
  paths.feedbackCandidates = feedbackPaths.candidatesPath;

  try {
    const command = buildFeedbackExportCommand({
      database: args.feedbackDatabase,
      limit: args.feedbackLimit,
      outputDir: path.dirname(paths.feedbackExport),
      remote: args.feedbackRemote,
      noCandidates: false,
    });
    const runner = commandRunner ?? defaultCommandRunner;
    const stdout = await runner(command.command, command.args);
    const written = await writeFeedbackArtifacts(stdout, paths.feedbackExport, feedbackPaths, now);
    return { rows: written.rowCount, candidates: written.candidateCount, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { rows: null, candidates: null, error: message };
  }
}

async function defaultCommandRunner(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    maxBuffer: WRANGLER_MAX_BUFFER_BYTES,
  });
  return stdout;
}

function buildMaintenanceReport(input: {
  now: Date;
  outputDir: string;
  statusSource: string;
  paths: SemesterMaintenanceArtifactPaths;
  retention: TermRetentionReport;
  coverage: TermCoverageReport;
  freshness: FreshnessAuditReport;
  feedbackRows: number | null;
  feedbackCandidates: number | null;
  feedbackError: string | null;
}): SemesterMaintenanceReport {
  const failedFreshness = input.freshness.checks.filter(check => !check.ok);
  const droppedTermAbsenceFailed = failedFreshness.some(check => check.name === 'dropped term absence');
  const gates: SemesterMaintenanceGate[] = [
    {
      name: 'retention plan generated',
      ok: input.retention.warnings.length === 0,
      detail: input.retention.warnings.length === 0
        ? `${input.retention.counts.retained_terms} retained, ${input.retention.counts.dropped_terms} dropped`
        : input.retention.warnings.join('; '),
    },
    {
      name: 'retained term coverage',
      ok: input.coverage.counts.terms_needing_backfill === 0 && input.coverage.warnings.length === 0,
      detail: input.coverage.counts.terms_needing_backfill === 0
        ? `${input.coverage.counts.retained_terms} retained term(s) covered`
        : `${input.coverage.counts.terms_needing_backfill} retained term(s) need backfill`,
    },
    {
      name: 'freshness audit',
      ok: failedFreshness.length === 0,
      detail: failedFreshness.length === 0
        ? `${input.freshness.checks.length} checks passing`
        : failedFreshness.map(check => check.name).join(', '),
    },
    {
      name: 'feedback export',
      ok: input.feedbackError === null,
      detail: input.feedbackError ?? `${input.feedbackRows ?? 0} row(s), ${input.feedbackCandidates ?? 0} candidate(s)`,
    },
  ];

  return {
    generated_at: input.now.toISOString(),
    output_dir: input.outputDir,
    status_source: input.statusSource,
    artifacts: input.paths,
    counts: {
      retained_terms: input.retention.counts.retained_terms,
      dropped_terms: input.retention.counts.dropped_terms,
      coverage_terms_needing_backfill: input.coverage.counts.terms_needing_backfill,
      freshness_failed_checks: failedFreshness.length,
      feedback_rows: input.feedbackRows,
      feedback_candidates: input.feedbackCandidates,
    },
    backup_required_before_prune: droppedTermAbsenceFailed,
    gates,
    next_actions: nextActions(input.coverage, failedFreshness, input.feedbackCandidates, input.feedbackError),
  };
}

function nextActions(
  coverage: TermCoverageReport,
  failedFreshness: FreshnessAuditReport['checks'],
  feedbackCandidates: number | null,
  feedbackError: string | null
): string[] {
  const actions: string[] = [];

  if (failedFreshness.some(check => check.name === 'dropped term absence')) {
    actions.push('Create and restore-verify a D1 Time Travel backup before executing the generated prune SQL remotely.');
  }
  if (coverage.counts.terms_needing_backfill > 0) {
    actions.push('Use the generated coverage report backfill commands after backup evidence is recorded.');
  }
  if (failedFreshness.length > 0) {
    actions.push(`Resolve failed freshness checks: ${failedFreshness.map(check => check.name).join(', ')}.`);
  }
  if (feedbackError) {
    actions.push('Fix the feedback export failure so unintuitive-result reports keep feeding the query corpus.');
  } else if ((feedbackCandidates ?? 0) > 0) {
    actions.push('Review generated feedback candidates and promote accepted items into evals, score audits, link audits, or copy audits.');
  }

  return actions;
}

async function main(): Promise<void> {
  const args = parseSemesterMaintenanceArgs(process.argv.slice(2));
  const report = await runSemesterMaintenancePlan(args);
  process.stdout.write(formatSemesterMaintenanceReport(report));

  if (report.gates.some(gate => !gate.ok)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
