import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
const TERM_ORDER: Record<Term, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
};
const DEFAULT_FRONTEND_BASE = 'https://courses.illinois.edu';
const DEFAULT_FROM_YEAR = 2004;

type Term = typeof TERMS[number];
type TermStatus = 'registrable' | 'active' | 'historical';
type Fetcher = (request: Request) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export type TermCoverageArgs = {
  fromYear: number;
  toYear: number;
  frontendBase: string;
  statusInput?: string;
  output?: string;
  currentYear?: number;
  currentTerm?: Term;
};

export type AvailableTerm = {
  year: number;
  term: Term;
  term_id: string;
};

export type TermCoverageRow = AvailableTerm & {
  expected_status: TermStatus;
  present: boolean;
  stored_status: string | null;
  stale: boolean;
  courses_count: number | null;
  sections_count: number | null;
  last_synced: number | null;
  needs_backfill: boolean;
  reason: string;
};

export type TermCoverageReport = {
  generated_at: string;
  frontend_base: string;
  from_year: number;
  to_year: number;
  current_year: number;
  current_term: Term;
  status_source: string | null;
  counts: {
    available_terms: number;
    present_terms: number;
    missing_terms: number;
    stale_terms: number;
    terms_needing_backfill: number;
    expected_historical_terms: number;
  };
  terms: TermCoverageRow[];
  warnings: string[];
  backfill_commands: string[];
  freshness_audit_command: string;
};

function termId(year: number, term: Term): string {
  return `${year}-${term}`;
}

function isTerm(value: unknown): value is Term {
  return typeof value === 'string' && (TERMS as readonly string[]).includes(value.toLowerCase());
}

function normalizeTerm(value: unknown): Term | null {
  return isTerm(value) ? value.toLowerCase() as Term : null;
}

function parseNonNegativeInt(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

function inferCurrentTerm(date = new Date()): Term {
  const month = date.getMonth() + 1;
  if (month <= 1) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}

function compareTerms(year: number, term: Term, currentYear: number, currentTerm: Term): number {
  if (year !== currentYear) return year - currentYear;
  return TERM_ORDER[term] - TERM_ORDER[currentTerm];
}

function expectedStatus(row: AvailableTerm, stored: JsonRecord | undefined, currentYear: number, currentTerm: Term): TermStatus {
  if (stored?.status === 'registrable' || stored?.status === 'active' || stored?.status === 'historical') {
    return stored.status;
  }
  return compareTerms(row.year, row.term, currentYear, currentTerm) < 0 ? 'historical' : 'active';
}

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function numericOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: number | null): boolean {
  return typeof value === 'number' && value > 0;
}

function statusTermStates(status: JsonRecord | null): JsonRecord[] {
  return Array.isArray(status?.termStates)
    ? status.termStates.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function statusSyncStates(status: JsonRecord | null): JsonRecord[] {
  return Array.isArray(status?.syncStates)
    ? status.syncStates.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function staleTermIds(status: JsonRecord | null): Set<string> {
  const freshness = asRecord(status?.freshness);
  const values = Array.isArray(freshness?.staleTermIds) ? freshness.staleTermIds : [];
  return new Set(values.filter((item): item is string => typeof item === 'string'));
}

function parseTermStateId(row: JsonRecord): string | null {
  if (typeof row.term_id === 'string') return row.term_id;
  const year = numericOrNull(row.year);
  const term = normalizeTerm(row.term);
  return year && term ? termId(year, term) : null;
}

function completedSubjectSyncCount(syncStates: JsonRecord[], termIdValue: string): number {
  const prefix = `course-sync:${termIdValue}:`;
  return syncStates.filter(state =>
    typeof state.id === 'string'
    && state.id.startsWith(prefix)
    && state.last_status === 'complete'
  ).length;
}

function backfillCommand(row: TermCoverageRow): string {
  return [
    'npm run data:backfill:term --',
    `--year ${row.year}`,
    `--term ${row.term}`,
    `--status ${row.expected_status}`,
    '--page-size 20',
    '--backup-ref "$BACKUP_REF"',
    '--evidence-file "artifacts/d1-backups/$BACKUP_REF-term-coverage/evidence.md"',
    '--restore-verified',
    `--output "artifacts/backfill/${row.term_id}-$BACKUP_REF.json"`,
  ].join(' ');
}

function buildRow(
  term: AvailableTerm,
  stored: JsonRecord | undefined,
  completedSubjects: number,
  staleTerms: Set<string>,
  currentYear: number,
  currentTerm: Term
): TermCoverageRow {
  const coursesCount = numericOrNull(stored?.courses_count);
  const sectionsCount = numericOrNull(stored?.sections_count);
  const subjectsCount = numericOrNull(stored?.subjects_count);
  const present = stored !== undefined;
  const stale = staleTerms.has(term.term_id);
  const missingCounts = present && (!positive(coursesCount) || !positive(sectionsCount));
  const inconsistentSubjectCount = present
    && subjectsCount !== null
    && subjectsCount > 0
    && completedSubjects > subjectsCount;
  const incompleteSubjects = present
    && subjectsCount !== null
    && subjectsCount > 0
    && completedSubjects < subjectsCount;
  const needsBackfill = !present || stale || missingCounts || inconsistentSubjectCount || incompleteSubjects;
  const reason = !present
    ? 'missing from term_state'
    : stale
      ? 'stale in freshness summary'
      : missingCounts
        ? 'missing course or section counts'
        : inconsistentSubjectCount
          ? `term_state records ${subjectsCount} subjects but ${completedSubjects} subjects have complete sync states`
          : incompleteSubjects
            ? `only ${completedSubjects}/${subjectsCount} subjects synced`
            : 'covered';

  return {
    ...term,
    expected_status: expectedStatus(term, stored, currentYear, currentTerm),
    present,
    stored_status: typeof stored?.status === 'string' ? stored.status : null,
    stale,
    courses_count: coursesCount,
    sections_count: sectionsCount,
    last_synced: numericOrNull(stored?.last_synced),
    needs_backfill: needsBackfill,
    reason,
  };
}

export function parseTermCoverageArgs(argv: string[]): TermCoverageArgs {
  const currentYear = new Date().getFullYear();
  const args: TermCoverageArgs = {
    fromYear: DEFAULT_FROM_YEAR,
    toYear: currentYear + 1,
    frontendBase: DEFAULT_FRONTEND_BASE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--from-year' && next) {
      args.fromYear = parseNonNegativeInt(next, '--from-year');
      index += 1;
    } else if (arg === '--to-year' && next) {
      args.toYear = parseNonNegativeInt(next, '--to-year');
      index += 1;
    } else if (arg === '--frontend-base' && next) {
      args.frontendBase = next;
      index += 1;
    } else if (arg === '--status-input' && next) {
      args.statusInput = next;
      index += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      index += 1;
    } else if (arg === '--current-year' && next) {
      args.currentYear = parseNonNegativeInt(next, '--current-year');
      index += 1;
    } else if (arg === '--current-term' && next) {
      const term = normalizeTerm(next);
      if (!term) throw new Error('--current-term must be one of: winter, spring, summer, fall');
      args.currentTerm = term;
      index += 1;
    }
  }

  if (args.fromYear > args.toYear) {
    throw new Error('--from-year must be less than or equal to --to-year');
  }

  return args;
}

export async function discoverAvailableTerms(
  args: Pick<TermCoverageArgs, 'fromYear' | 'toYear' | 'frontendBase'>,
  fetcher: Fetcher = request => fetch(request)
): Promise<{ terms: AvailableTerm[]; warnings: string[] }> {
  const terms: AvailableTerm[] = [];
  const warnings: string[] = [];

  for (let year = args.fromYear; year <= args.toYear; year += 1) {
    const url = endpoint(args.frontendBase, `ajax/search/termlist/${year}`);
    const response = await fetcher(new Request(url));
    if (!response.ok) {
      warnings.push(`term list ${year} failed with HTTP ${response.status}`);
      continue;
    }

    const body = await response.json().catch(() => null) as unknown;
    const record = asRecord(body);
    if (!record) {
      warnings.push(`term list ${year} returned a non-object response`);
      continue;
    }

    for (const value of Object.values(record)) {
      const term = normalizeTerm(value);
      if (term) terms.push({ year, term, term_id: termId(year, term) });
    }
  }

  terms.sort((left, right) => left.year - right.year || TERM_ORDER[left.term] - TERM_ORDER[right.term]);
  return { terms, warnings };
}

async function loadStatus(input?: string): Promise<{ source: string | null; status: JsonRecord | null }> {
  if (!input) return { source: null, status: null };

  const body = await readFile(input, 'utf8');
  const parsed = JSON.parse(body) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new Error('--status-input must contain a JSON object from /admin/sync/status');
  }
  return { source: input, status: record };
}

export async function buildTermCoverageReport(
  args: TermCoverageArgs,
  options: {
    fetcher?: Fetcher;
    status?: JsonRecord | null;
    statusSource?: string | null;
    now?: Date;
  } = {}
): Promise<TermCoverageReport> {
  const currentYear = args.currentYear ?? options.now?.getFullYear() ?? new Date().getFullYear();
  const currentTerm = args.currentTerm ?? inferCurrentTerm(options.now);
  const statusResult = options.status === undefined
    ? await loadStatus(args.statusInput)
    : { status: options.status, source: options.statusSource ?? args.statusInput ?? null };
  const discovered = await discoverAvailableTerms(args, options.fetcher);
  const storedByTermId = new Map<string, JsonRecord>();
  const syncStates = statusSyncStates(statusResult.status);

  for (const state of statusTermStates(statusResult.status)) {
    const id = parseTermStateId(state);
    if (id) storedByTermId.set(id, state);
  }

  const stale = staleTermIds(statusResult.status);
  const terms = discovered.terms.map(term => buildRow(
    term,
    storedByTermId.get(term.term_id),
    completedSubjectSyncCount(syncStates, term.term_id),
    stale,
    currentYear,
    currentTerm
  ));
  const needingBackfill = terms.filter(term => term.needs_backfill);
  const expectedHistoricalTerms = terms.filter(term => term.expected_status === 'historical').length;

  return {
    generated_at: new Date().toISOString(),
    frontend_base: args.frontendBase,
    from_year: args.fromYear,
    to_year: args.toYear,
    current_year: currentYear,
    current_term: currentTerm,
    status_source: statusResult.source,
    counts: {
      available_terms: terms.length,
      present_terms: terms.filter(term => term.present).length,
      missing_terms: terms.filter(term => !term.present).length,
      stale_terms: terms.filter(term => term.stale).length,
      terms_needing_backfill: needingBackfill.length,
      expected_historical_terms: expectedHistoricalTerms,
    },
    terms,
    warnings: discovered.warnings,
    backfill_commands: needingBackfill.map(backfillCommand),
    freshness_audit_command: `npm run data:freshness:audit -- --input artifacts/sync-status.json --min-historical-terms ${expectedHistoricalTerms}`,
  };
}

export function formatTermCoverageReport(report: TermCoverageReport): string {
  const lines = [
    '# Term Coverage Plan',
    '',
    `Generated at: ${report.generated_at}`,
    `Frontend base: ${report.frontend_base}`,
    `Year range: ${report.from_year}-${report.to_year}`,
    `Current term reference: ${report.current_year} ${report.current_term}`,
    `Status source: ${report.status_source ?? 'not provided'}`,
    '',
    '## Counts',
    '',
    `- Available terms: ${report.counts.available_terms}`,
    `- Present terms: ${report.counts.present_terms}`,
    `- Missing terms: ${report.counts.missing_terms}`,
    `- Stale terms: ${report.counts.stale_terms}`,
    `- Terms needing backfill: ${report.counts.terms_needing_backfill}`,
    `- Expected historical terms: ${report.counts.expected_historical_terms}`,
    '',
    '## Freshness Gate',
    '',
    report.freshness_audit_command,
    '',
  ];

  if (report.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  lines.push('## Terms Needing Backfill', '');
  const rows = report.terms.filter(term => term.needs_backfill);
  if (rows.length === 0) {
    lines.push('All discovered terms are covered.');
  } else {
    for (const row of rows) {
      lines.push(`- ${row.term_id} (${row.expected_status}): ${row.reason}`);
    }
  }

  lines.push('', '## Backfill Commands', '');
  if (report.backfill_commands.length === 0) {
    lines.push('No backfill commands required.');
  } else {
    for (const command of report.backfill_commands) {
      lines.push(`- \`${command}\``);
    }
  }

  return `${lines.join('\n')}\n`;
}

function markdownOutputFor(output: string): string {
  return /\.json$/i.test(output) ? output.replace(/\.json$/i, '.md') : `${output}.md`;
}

function writeReport(output: string, report: TermCoverageReport): void {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownOutputFor(output), formatTermCoverageReport(report));
}

async function main(): Promise<void> {
  const args = parseTermCoverageArgs(process.argv.slice(2));
  const report = await buildTermCoverageReport(args);

  if (args.output) {
    writeReport(args.output, report);
  }
  process.stdout.write(formatTermCoverageReport(report));

  if (report.counts.terms_needing_backfill > 0 || report.warnings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
