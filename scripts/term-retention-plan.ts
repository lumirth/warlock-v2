import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
const STATUSES = ['registrable', 'active', 'historical'] as const;
const TERM_ORDER: Record<Term, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
};

const DEFAULT_FRONTEND_BASE = 'https://courses.illinois.edu';
const DEFAULT_FROM_YEAR = 2004;
const DEFAULT_TARGET_SIZE_MB = 250;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const FALLBACK_COURSES_PER_TERM = 4_500;
const FALLBACK_SECTIONS_PER_TERM = 12_000;
const ROW_BYTE_ESTIMATE = {
  termState: 512,
  course: 420,
  section: 520,
  meeting: 360,
  meetingInstructor: 96,
  courseGened: 160,
  subjectSyncState: 192,
} as const;

type Term = typeof TERMS[number];
type TermStatus = typeof STATUSES[number];
type Fetcher = (request: Request) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export type TermRetentionArgs = {
  fromYear: number;
  toYear: number;
  frontendBase: string;
  statusInput?: string;
  output?: string;
  sqlOutput?: string;
  currentYear?: number;
  currentTerm?: Term;
  targetSizeMb: number;
  maxRetainedTerms?: number;
};

type AvailableTerm = {
  year: number;
  term: Term;
  term_id: string;
};

export type RetentionDecision = 'retain' | 'drop';

export type TermRetentionRow = AvailableTerm & {
  expected_status: TermStatus;
  present: boolean;
  stored_status: string | null;
  courses_count: number | null;
  sections_count: number | null;
  last_synced: number | null;
  pinned: boolean;
  estimated_bytes: number;
  retention_decision: RetentionDecision;
  retention_reason: string;
};

export type TermRetentionReport = {
  generated_at: string;
  frontend_base: string;
  from_year: number;
  to_year: number;
  current_year: number;
  current_term: Term;
  status_source: string | null;
  target_size_mb: number;
  target_size_bytes: number;
  max_retained_terms: number | null;
  counts: {
    available_terms: number;
    retained_terms: number;
    dropped_terms: number;
    pinned_terms: number;
    retained_historical_terms: number;
    retained_active_terms: number;
    retained_registrable_terms: number;
    estimated_retained_bytes: number;
    estimated_dropped_bytes: number;
  };
  terms: TermRetentionRow[];
  retained_term_ids: string[];
  dropped_term_ids: string[];
  warnings: string[];
  prune_sql: string;
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

function normalizeStatus(value: unknown): TermStatus | null {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value.toLowerCase())
    ? value.toLowerCase() as TermStatus
    : null;
}

function parseNonNegativeInt(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

function parseNonNegativeFloat(value: string | undefined, name: string): number {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return Number.parseFloat(value);
}

function inferCurrentTerm(date = new Date()): Term {
  const month = date.getMonth() + 1;
  if (month <= 1) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
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

function positiveOrFallback(value: number | null, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback;
}

function statusTermStates(status: JsonRecord | null): JsonRecord[] {
  return Array.isArray(status?.termStates)
    ? status.termStates.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function parseTermStateId(row: JsonRecord): string | null {
  if (typeof row.term_id === 'string') return row.term_id;
  const year = numericOrNull(row.year);
  const term = normalizeTerm(row.term);
  return year && term ? termId(year, term) : null;
}

function compareTerms(year: number, term: Term, currentYear: number, currentTerm: Term): number {
  if (year !== currentYear) return year - currentYear;
  return TERM_ORDER[term] - TERM_ORDER[currentTerm];
}

function expectedStatus(row: AvailableTerm, stored: JsonRecord | undefined, currentYear: number, currentTerm: Term): TermStatus {
  return normalizeStatus(stored?.status)
    ?? (compareTerms(row.year, row.term, currentYear, currentTerm) < 0 ? 'historical' : 'active');
}

function regularTermRank(term: Term): number {
  return term === 'fall' || term === 'spring' ? 0 : 1;
}

function retentionPriorityScore(row: Pick<TermRetentionRow, 'year' | 'term'>): number {
  const regularSemesterBoost = regularTermRank(row.term) === 0 ? 6 : 0;
  return row.year * TERMS.length + TERM_ORDER[row.term] + regularSemesterBoost;
}

function sortRetentionCandidates(rows: TermRetentionRow[]): TermRetentionRow[] {
  return [...rows].sort((left, right) => {
    const scoreDelta = retentionPriorityScore(right) - retentionPriorityScore(left);
    if (scoreDelta !== 0) return scoreDelta;

    if (left.year !== right.year) return right.year - left.year;
    return TERM_ORDER[right.term] - TERM_ORDER[left.term];
  });
}

function sortRetainedOutputRows(rows: TermRetentionRow[]): TermRetentionRow[] {
  return [...rows].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return sortRetentionCandidates([left, right])[0] === left ? -1 : 1;
  });
}

function estimatedBytes(stored: JsonRecord | undefined): number {
  const courses = positiveOrFallback(numericOrNull(stored?.courses_count), FALLBACK_COURSES_PER_TERM);
  const sections = positiveOrFallback(numericOrNull(stored?.sections_count), FALLBACK_SECTIONS_PER_TERM);
  const meetings = Math.ceil(sections * 1.07);
  const meetingInstructors = Math.ceil(sections * 1.26);
  const geneds = Math.ceil(courses * 0.18);
  const subjectSyncStates = Math.ceil(courses / 25);

  return ROW_BYTE_ESTIMATE.termState
    + courses * ROW_BYTE_ESTIMATE.course
    + sections * ROW_BYTE_ESTIMATE.section
    + meetings * ROW_BYTE_ESTIMATE.meeting
    + meetingInstructors * ROW_BYTE_ESTIMATE.meetingInstructor
    + geneds * ROW_BYTE_ESTIMATE.courseGened
    + subjectSyncStates * ROW_BYTE_ESTIMATE.subjectSyncState;
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function termPairCondition(rows: TermRetentionRow[], prefix = ''): string {
  if (rows.length === 0) return '0';
  return rows
    .map(row => `(${prefix}year = ${row.year} AND ${prefix}term = ${sqlQuote(row.term)})`)
    .join(' OR ');
}

function termIdInList(rows: TermRetentionRow[], column: string): string {
  if (rows.length === 0) return '0';
  return `${column} IN (${rows.map(row => sqlQuote(row.term_id)).join(', ')})`;
}

export function generatePruneSql(rows: TermRetentionRow[]): string {
  const dropped = rows.filter(row => row.retention_decision === 'drop');
  const retained = rows.filter(row => row.retention_decision === 'retain');

  if (dropped.length === 0) {
    return [
      '-- Term retention prune SQL',
      '-- No dropped terms in this plan.',
      '',
      '-- Verification',
      `SELECT 'retained_terms', COUNT(*) FROM term_state WHERE ${termIdInList(retained, 'term_id')};`,
      '',
    ].join('\n');
  }

  const droppedTermIds = dropped.map(row => sqlQuote(row.term_id)).join(', ');
  const droppedSyncStateCondition = dropped
    .map(row => `id LIKE ${sqlQuote(`course-sync:${row.term_id}:%`)}`)
    .join(' OR ');

  return [
    '-- Term retention prune SQL',
    '-- Create and restore-verify a D1 Time Travel backup before executing this file remotely.',
    '-- This intentionally deletes old terms completely so every searchable retained term stays full-detail.',
    '-- Wrangler/D1 rejects explicit BEGIN/COMMIT in uploaded SQL; failed file execution is rolled back by D1.',
    '',
    'PRAGMA foreign_keys = ON;',
    '',
    'DELETE FROM meeting_instructors',
    'WHERE meeting_id IN (',
    '  SELECT m.id',
    '  FROM meetings m',
    '  JOIN sections s ON s.id = m.section_id',
    `  WHERE ${termIdInList(dropped, 's.term_id')}`,
    ');',
    '',
    'DELETE FROM meetings',
    'WHERE section_id IN (',
    '  SELECT id FROM sections',
    `  WHERE ${termIdInList(dropped, 'term_id')}`,
    ');',
    '',
    `DELETE FROM instructor_course_links WHERE ${termIdInList(dropped, 'term_id')};`,
    '',
    'DELETE FROM course_gened',
    'WHERE course_id IN (',
    '  SELECT id FROM courses',
    `  WHERE ${termPairCondition(dropped)}`,
    ');',
    '',
    `DELETE FROM sections WHERE ${termIdInList(dropped, 'term_id')};`,
    '',
    `DELETE FROM courses WHERE ${termPairCondition(dropped)};`,
    '',
    `DELETE FROM sync_state WHERE ${droppedSyncStateCondition};`,
    '',
    `DELETE FROM term_state WHERE term_id IN (${droppedTermIds});`,
    '',
    "-- Compact FTS delete markers after the base-row deletes. Run these even if VACUUM is unavailable.",
    "INSERT INTO courses_fts(courses_fts) VALUES('optimize');",
    "INSERT INTO sections_fts(sections_fts) VALUES('optimize');",
    '',
    '-- Verification: every row should be 0 except retained_terms.',
    `SELECT 'dropped_term_state', COUNT(*) FROM term_state WHERE term_id IN (${droppedTermIds});`,
    `SELECT 'dropped_courses', COUNT(*) FROM courses WHERE ${termPairCondition(dropped)};`,
    `SELECT 'dropped_sections', COUNT(*) FROM sections WHERE ${termIdInList(dropped, 'term_id')};`,
    `SELECT 'dropped_instructor_links', COUNT(*) FROM instructor_course_links WHERE ${termIdInList(dropped, 'term_id')};`,
    `SELECT 'dropped_sync_state', COUNT(*) FROM sync_state WHERE ${droppedSyncStateCondition};`,
    "SELECT 'orphan_meetings', COUNT(*) FROM meetings m LEFT JOIN sections s ON s.id = m.section_id WHERE s.id IS NULL;",
    "SELECT 'orphan_meeting_instructors', COUNT(*) FROM meeting_instructors mi LEFT JOIN meetings m ON m.id = mi.meeting_id WHERE m.id IS NULL;",
    `SELECT 'retained_terms', COUNT(*) FROM term_state WHERE ${termIdInList(retained, 'term_id')};`,
    '',
  ].join('\n');
}

function markdownOutputFor(output: string): string {
  return /\.json$/i.test(output) ? output.replace(/\.json$/i, '.md') : `${output}.md`;
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

export function parseTermRetentionArgs(argv: string[]): TermRetentionArgs {
  const currentYear = new Date().getFullYear();
  const args: TermRetentionArgs = {
    fromYear: DEFAULT_FROM_YEAR,
    toYear: currentYear + 1,
    frontendBase: DEFAULT_FRONTEND_BASE,
    targetSizeMb: DEFAULT_TARGET_SIZE_MB,
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
    } else if (arg === '--sql-output' && next) {
      args.sqlOutput = next;
      index += 1;
    } else if (arg === '--current-year' && next) {
      args.currentYear = parseNonNegativeInt(next, '--current-year');
      index += 1;
    } else if (arg === '--current-term' && next) {
      const term = normalizeTerm(next);
      if (!term) throw new Error('--current-term must be one of: winter, spring, summer, fall');
      args.currentTerm = term;
      index += 1;
    } else if (arg === '--target-size-mb' && next) {
      args.targetSizeMb = parseNonNegativeFloat(next, '--target-size-mb');
      index += 1;
    } else if (arg === '--max-retained-terms' && next) {
      args.maxRetainedTerms = parseNonNegativeInt(next, '--max-retained-terms');
      index += 1;
    }
  }

  if (args.fromYear > args.toYear) {
    throw new Error('--from-year must be less than or equal to --to-year');
  }
  if (args.maxRetainedTerms !== undefined && args.maxRetainedTerms < 1) {
    throw new Error('--max-retained-terms must be at least 1');
  }

  return args;
}

export async function discoverAvailableTerms(
  args: Pick<TermRetentionArgs, 'fromYear' | 'toYear' | 'frontendBase'>,
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

export async function buildTermRetentionReport(
  args: TermRetentionArgs,
  options: {
    fetcher?: Fetcher;
    status?: JsonRecord | null;
    statusSource?: string | null;
    now?: Date;
  } = {}
): Promise<TermRetentionReport> {
  const currentYear = args.currentYear ?? options.now?.getFullYear() ?? new Date().getFullYear();
  const currentTerm = args.currentTerm ?? inferCurrentTerm(options.now);
  const statusResult = options.status === undefined
    ? await loadStatus(args.statusInput)
    : { status: options.status, source: options.statusSource ?? args.statusInput ?? null };
  const discovered = await discoverAvailableTerms(args, options.fetcher);
  const storedByTermId = new Map<string, JsonRecord>();

  for (const state of statusTermStates(statusResult.status)) {
    const id = parseTermStateId(state);
    if (id) storedByTermId.set(id, state);
  }

  const targetSizeBytes = Math.round(args.targetSizeMb * BYTES_PER_MEGABYTE);
  const baseRows = discovered.terms.map((term): TermRetentionRow => {
    const stored = storedByTermId.get(term.term_id);
    const status = expectedStatus(term, stored, currentYear, currentTerm);
    return {
      ...term,
      expected_status: status,
      present: stored !== undefined,
      stored_status: typeof stored?.status === 'string' ? stored.status : null,
      courses_count: numericOrNull(stored?.courses_count),
      sections_count: numericOrNull(stored?.sections_count),
      last_synced: numericOrNull(stored?.last_synced),
      pinned: status === 'registrable' || status === 'active',
      estimated_bytes: estimatedBytes(stored),
      retention_decision: 'drop',
      retention_reason: 'outside retention budget',
    };
  });

  const retainedIds = new Set<string>();
  const warnings = [...discovered.warnings];
  let estimatedRetainedBytes = 0;

  for (const row of sortRetentionCandidates(baseRows.filter(term => term.pinned))) {
    retainedIds.add(row.term_id);
    estimatedRetainedBytes += row.estimated_bytes;
  }

  if (estimatedRetainedBytes > targetSizeBytes) {
    warnings.push(`pinned active/registrable terms exceed target size estimate: ${estimatedRetainedBytes} > ${targetSizeBytes}`);
  }
  if (args.maxRetainedTerms !== undefined && retainedIds.size > args.maxRetainedTerms) {
    warnings.push(`pinned active/registrable terms exceed --max-retained-terms: ${retainedIds.size} > ${args.maxRetainedTerms}`);
  }

  for (const row of sortRetentionCandidates(baseRows.filter(term => !term.pinned))) {
    const wouldExceedCount = args.maxRetainedTerms !== undefined && retainedIds.size >= args.maxRetainedTerms;
    const wouldExceedBytes = estimatedRetainedBytes + row.estimated_bytes > targetSizeBytes;
    if (wouldExceedCount || wouldExceedBytes) {
      break;
    }

    retainedIds.add(row.term_id);
    estimatedRetainedBytes += row.estimated_bytes;
  }

  const terms = baseRows.map(row => {
    const retained = retainedIds.has(row.term_id);
    return {
      ...row,
      retention_decision: retained ? 'retain' as const : 'drop' as const,
      retention_reason: retained
        ? row.pinned
          ? `pinned ${row.expected_status} term`
          : 'within rolling full-detail retention budget'
        : 'oldest term outside rolling full-detail retention budget',
    };
  });
  const retainedTerms = terms.filter(row => row.retention_decision === 'retain');
  const droppedTerms = terms.filter(row => row.retention_decision === 'drop');
  const pruneSql = generatePruneSql(terms);

  return {
    generated_at: new Date().toISOString(),
    frontend_base: args.frontendBase,
    from_year: args.fromYear,
    to_year: args.toYear,
    current_year: currentYear,
    current_term: currentTerm,
    status_source: statusResult.source,
    target_size_mb: args.targetSizeMb,
    target_size_bytes: targetSizeBytes,
    max_retained_terms: args.maxRetainedTerms ?? null,
    counts: {
      available_terms: terms.length,
      retained_terms: retainedTerms.length,
      dropped_terms: droppedTerms.length,
      pinned_terms: retainedTerms.filter(row => row.pinned).length,
      retained_historical_terms: retainedTerms.filter(row => row.expected_status === 'historical').length,
      retained_active_terms: retainedTerms.filter(row => row.expected_status === 'active').length,
      retained_registrable_terms: retainedTerms.filter(row => row.expected_status === 'registrable').length,
      estimated_retained_bytes: retainedTerms.reduce((total, row) => total + row.estimated_bytes, 0),
      estimated_dropped_bytes: droppedTerms.reduce((total, row) => total + row.estimated_bytes, 0),
    },
    terms,
    retained_term_ids: sortRetainedOutputRows(retainedTerms).map(row => row.term_id),
    dropped_term_ids: sortRetentionCandidates(droppedTerms).map(row => row.term_id),
    warnings,
    prune_sql: pruneSql,
  };
}

export function formatTermRetentionReport(report: TermRetentionReport): string {
  const retained = sortRetainedOutputRows(report.terms.filter(row => row.retention_decision === 'retain'));
  const dropped = report.terms.filter(row => row.retention_decision === 'drop');
  const lines = [
    '# Term Retention Plan',
    '',
    `Generated at: ${report.generated_at}`,
    `Frontend base: ${report.frontend_base}`,
    `Year range: ${report.from_year}-${report.to_year}`,
    `Current term reference: ${report.current_year} ${report.current_term}`,
    `Status source: ${report.status_source ?? 'not provided'}`,
    `Target size: ${report.target_size_mb} MB`,
    `Max retained terms: ${report.max_retained_terms ?? 'not capped'}`,
    '',
    '## Counts',
    '',
    `- Available terms: ${report.counts.available_terms}`,
    `- Retained terms: ${report.counts.retained_terms}`,
    `- Dropped terms: ${report.counts.dropped_terms}`,
    `- Pinned active/registrable terms: ${report.counts.pinned_terms}`,
    `- Retained historical terms: ${report.counts.retained_historical_terms}`,
    `- Estimated retained bytes: ${report.counts.estimated_retained_bytes}`,
    `- Estimated dropped bytes: ${report.counts.estimated_dropped_bytes}`,
    '',
  ];

  if (report.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  lines.push('## Retained Terms', '');
  for (const row of retained) {
    lines.push(`- ${row.term_id} (${row.expected_status}): ${row.retention_reason}`);
  }

  lines.push('', '## Dropped Terms', '');
  if (dropped.length === 0) {
    lines.push('No terms are dropped by this plan.');
  } else {
    for (const row of dropped) {
      lines.push(`- ${row.term_id} (${row.expected_status}): ${row.retention_reason}`);
    }
  }

  lines.push('', '## Prune SQL', '');
  lines.push(report.dropped_term_ids.length > 0
    ? 'Generate or inspect the sibling SQL artifact before executing remote D1 deletes.'
    : 'No prune SQL is required.');

  return `${lines.join('\n')}\n`;
}

function writeReport(args: TermRetentionArgs, report: TermRetentionReport): void {
  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(markdownOutputFor(args.output), formatTermRetentionReport(report));
  }

  const sqlOutput = args.sqlOutput
    ?? (args.output ? args.output.replace(/\.json$/i, '.sql') : undefined);
  if (sqlOutput) {
    mkdirSync(dirname(sqlOutput), { recursive: true });
    writeFileSync(sqlOutput, report.prune_sql);
  }
}

async function main(): Promise<void> {
  const args = parseTermRetentionArgs(process.argv.slice(2));
  const report = await buildTermRetentionReport(args);

  writeReport(args, report);
  process.stdout.write(formatTermRetentionReport(report));

  if (report.warnings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
