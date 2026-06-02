import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { FeedbackIssue, FeedbackKind } from '@uiuc-course-search/query-types';

type Args = {
  input?: string;
  output?: string;
};

type PromotionTarget =
  | 'search_eval'
  | 'score_audit'
  | 'link_audit'
  | 'data_freshness_audit'
  | 'copy_audit'
  | 'manual_review';

type CandidatePriority = 'high' | 'medium' | 'low';

export type FeedbackExportRow = {
  id?: string;
  kind: FeedbackKind;
  issue: FeedbackIssue;
  page?: 'search' | 'course';
  query?: string | null;
  course_id?: string | null;
  courseId?: string | null;
  subject?: string | null;
  number?: string | null;
  term?: string | null;
  year?: number | string | null;
  crn?: string | null;
  instructor_name?: string | null;
  instructorName?: string | null;
  score_field?: string | null;
  scoreField?: string | null;
  expected?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | string | null;
  created_at?: number | string | null;
  createdAt?: number | string | null;
};

type SuggestedGoldQuery = {
  query: string;
  expected_filters: Record<string, unknown>;
  expected_filter_keys?: string[];
  expected_residual: string;
  category: 'navigational' | 'structured' | 'semantic' | 'instructor' | 'score' | 'schedule';
  notes: string;
};

export type FeedbackCorpusCandidate = {
  id: string;
  target: PromotionTarget;
  priority: CandidatePriority;
  status: 'needs_review';
  issue: FeedbackIssue;
  kind: FeedbackKind;
  query?: string;
  expected?: string;
  message?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  crn?: string;
  instructorName?: string;
  scoreField?: string;
  createdAt?: number;
  metadata?: Record<string, unknown>;
  suggestedGoldQuery?: SuggestedGoldQuery;
  reviewChecklist: string[];
};

export type FeedbackCandidateReport = {
  generated_at: string;
  source: string;
  row_count: number;
  candidate_count: number;
  candidates: FeedbackCorpusCandidate[];
};

const SEARCH_EVAL_ISSUES: ReadonlySet<FeedbackIssue> = new Set([
  'expected_different_results',
  'missing_course',
]);

function usage(): string {
  return [
    'Feedback corpus candidate generator',
    '',
    'Usage:',
    '  npm run feedback:triage -- --input <feedback-export.json|feedback-export.ndjson|-> [--output <path>]',
    '',
    'Input may be:',
    '  - a JSON array of feedback_events rows',
    '  - Wrangler D1 JSON, e.g. [{ "results": [...] }]',
    '  - newline-delimited JSON rows',
    '',
    'Example:',
    '  wrangler d1 execute course-search-db-staging --remote --json --command "SELECT * FROM feedback_events ORDER BY created_at DESC LIMIT 200" > artifacts/feedback.json',
    '  npm run feedback:triage -- --input artifacts/feedback.json --output artifacts/feedback-candidates.json',
  ].join('\n');
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next) {
      args.input = next;
      i += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      i += 1;
    }
  }

  return args;
}

export function parseFeedbackExport(text: string): FeedbackExportRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    return extractRows(JSON.parse(trimmed));
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .flatMap(line => extractRows(JSON.parse(line)));
  }
}

export function buildFeedbackCandidateReport(rows: FeedbackExportRow[], source: string, now = new Date()): FeedbackCandidateReport {
  const candidates = rows
    .map((row, index) => buildCandidate(row, index))
    .filter((candidate): candidate is FeedbackCorpusCandidate => candidate !== null);

  return {
    generated_at: now.toISOString(),
    source,
    row_count: rows.length,
    candidate_count: candidates.length,
    candidates,
  };
}

function buildCandidate(row: FeedbackExportRow, index: number): FeedbackCorpusCandidate | null {
  if (!isKnownKind(row.kind) || !isKnownIssue(row.issue)) {
    return null;
  }

  const normalized = normalizeRow(row);
  const target = getPromotionTarget(normalized);
  const query = normalized.query || buildQueryFromCourseFields(normalized);
  const metadata = parseMetadata(normalized.metadata);
  const candidate: FeedbackCorpusCandidate = {
    id: normalized.id || `feedback-row-${index + 1}`,
    target,
    priority: getPriority(normalized, target),
    status: 'needs_review',
    issue: normalized.issue,
    kind: normalized.kind,
    query,
    expected: normalized.expected,
    message: normalized.message,
    courseId: normalized.courseId,
    subject: normalized.subject,
    number: normalized.number,
    term: normalized.term,
    year: normalized.year,
    crn: normalized.crn,
    instructorName: normalized.instructorName,
    scoreField: normalized.scoreField,
    createdAt: normalized.createdAt,
    metadata,
    reviewChecklist: buildReviewChecklist(target),
  };

  if (target === 'search_eval' && query) {
    candidate.suggestedGoldQuery = buildSuggestedGoldQuery(candidate);
  }

  return candidate;
}

function extractRows(value: unknown): FeedbackExportRow[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => extractRows(item));
  }

  if (isRecord(value)) {
    if (Array.isArray(value.results)) {
      return value.results.filter(isRecord).map(item => item as FeedbackExportRow);
    }
    if (Array.isArray(value.result)) {
      return value.result.filter(isRecord).map(item => item as FeedbackExportRow);
    }
    return [value as FeedbackExportRow];
  }

  return [];
}

function normalizeRow(row: FeedbackExportRow): Required<Pick<FeedbackExportRow, 'kind' | 'issue'>> & {
  id?: string;
  query?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  crn?: string;
  instructorName?: string;
  scoreField?: string;
  expected?: string;
  message?: string;
  metadata?: FeedbackExportRow['metadata'];
  createdAt?: number;
} {
  return {
    id: optionalString(row.id),
    kind: row.kind,
    issue: row.issue,
    query: optionalString(row.query),
    courseId: optionalString(row.courseId) ?? optionalString(row.course_id),
    subject: optionalString(row.subject)?.toUpperCase(),
    number: optionalString(row.number),
    term: optionalString(row.term)?.toLowerCase(),
    year: optionalInteger(row.year),
    crn: optionalString(row.crn),
    instructorName: optionalString(row.instructorName) ?? optionalString(row.instructor_name),
    scoreField: optionalString(row.scoreField) ?? optionalString(row.score_field),
    expected: optionalString(row.expected),
    message: optionalString(row.message),
    metadata: row.metadata,
    createdAt: optionalInteger(row.createdAt) ?? optionalInteger(row.created_at),
  };
}

function buildSuggestedGoldQuery(candidate: FeedbackCorpusCandidate): SuggestedGoldQuery {
  const expectedFilters: Record<string, unknown> = {};
  const expectedFilterKeys = new Set<string>();
  const notes: string[] = [`Promoted from feedback ${candidate.id}. Review before adding to GOLDEN_QUERIES.`];

  if (candidate.subject) expectedFilters.subject = candidate.subject;
  if (candidate.number) expectedFilters.number = candidate.number;
  if (candidate.crn) expectedFilters.crn = candidate.crn;
  if (candidate.term) expectedFilters.term = candidate.term;
  if (candidate.year) expectedFilters.year = candidate.year;

  if (hasInstructorExpectation(candidate)) {
    expectedFilterKeys.add('instructor_ids');
    notes.push('Instructor IDs depend on database rows; keep expected_filter_keys unless a stable instructor fixture exists.');
  }

  const category = inferGoldCategory(candidate);
  if (category === 'score') {
    notes.push('Add score invariants or expected top result after reviewing live data.');
  }

  const keys = [...expectedFilterKeys];
  return {
    query: candidate.query!,
    expected_filters: expectedFilters,
    expected_filter_keys: keys.length > 0 ? keys : undefined,
    expected_residual: inferExpectedResidual(candidate, expectedFilters, keys),
    category,
    notes: notes.join(' '),
  };
}

function getPromotionTarget(row: ReturnType<typeof normalizeRow>): PromotionTarget {
  if (SEARCH_EVAL_ISSUES.has(row.issue) || row.kind === 'search_results') return 'search_eval';
  if (row.issue === 'wrong_score' || row.kind === 'score') return 'score_audit';
  if (row.issue === 'broken_link' || row.kind === 'external_link') return 'link_audit';
  if (row.issue === 'stale_data' || row.kind === 'data_freshness') return 'data_freshness_audit';
  if (row.issue === 'confusing_copy' || row.kind === 'copy_confusion') return 'copy_audit';
  return 'manual_review';
}

function getPriority(row: ReturnType<typeof normalizeRow>, target: PromotionTarget): CandidatePriority {
  if (target === 'search_eval' && row.query && (row.expected || row.subject || row.number || row.instructorName)) return 'high';
  if (target === 'score_audit' && (row.courseId || row.subject || row.number) && row.scoreField) return 'high';
  if (target === 'link_audit' || target === 'data_freshness_audit') return 'medium';
  return row.message || row.expected ? 'medium' : 'low';
}

function inferGoldCategory(candidate: FeedbackCorpusCandidate): SuggestedGoldQuery['category'] {
  if (hasInstructorExpectation(candidate)) return 'instructor';
  if (candidate.scoreField || candidate.issue === 'wrong_score') return 'score';
  if (candidate.crn || (candidate.subject && candidate.number)) return 'navigational';
  if (mentionsSchedule(candidate)) return 'schedule';
  if (candidate.subject || candidate.term || candidate.year) return 'structured';
  return 'semantic';
}

function inferExpectedResidual(
  candidate: FeedbackCorpusCandidate,
  expectedFilters: Record<string, unknown>,
  expectedFilterKeys: string[]
): string {
  const query = candidate.query?.trim().toUpperCase();
  const courseCode = [expectedFilters.subject, expectedFilters.number].filter(Boolean).join(' ');
  if (query && courseCode && query === courseCode) return '';
  if (query && expectedFilters.crn && query === `CRN ${expectedFilters.crn}`) return '';
  if (expectedFilterKeys.includes('instructor_ids') && !candidate.expected) return '';
  return '__REVIEW_RESIDUAL__';
}

function buildQueryFromCourseFields(row: ReturnType<typeof normalizeRow>): string | undefined {
  if (row.subject && row.number) return `${row.subject} ${row.number}`;
  if (row.crn) return `CRN ${row.crn}`;
  if (row.subject) return row.subject;
  return undefined;
}

function hasInstructorExpectation(candidate: FeedbackCorpusCandidate): boolean {
  const haystack = [
    candidate.query,
    candidate.expected,
    candidate.message,
    candidate.instructorName,
  ].filter(Boolean).join(' ');

  return /\b(professor|prof|instructor|taught by|with|dr\.?)\b/i.test(haystack);
}

function mentionsSchedule(candidate: FeedbackCorpusCandidate): boolean {
  const haystack = [candidate.query, candidate.expected, candidate.message].filter(Boolean).join(' ');
  return /\b(MWF|TR|morning|afternoon|evening|online|in person|credits?)\b/i.test(haystack);
}

function buildReviewChecklist(target: PromotionTarget): string[] {
  if (target === 'search_eval') {
    return [
      'Reproduce the reported query locally or on staging.',
      'Confirm the expected result or expected filters with Course Explorer data.',
      'Promote the reviewed case into GOLDEN_QUERIES or the relevant extractor fixture.',
      'Run npm run eval:smoke and targeted extractor/search tests.',
    ];
  }
  if (target === 'score_audit') {
    return [
      'Inspect the course score inputs for GPA, RMP, quality, and workload.',
      'Compare displayed score copy with the source rows and sample sizes.',
      'Add or update a score DTO/UI test if the report is valid.',
    ];
  }
  if (target === 'link_audit') {
    return [
      'Open the reported external link in Browser QA.',
      'Verify Course Explorer or Rate My Professors fallback behavior.',
      'Add a DTO/UI test for the broken link class.',
    ];
  }
  if (target === 'data_freshness_audit') {
    return [
      'Check /admin/sync/status freshness for the reported term or data source.',
      'Run the relevant sync in staging after backup preflight if data mutation is needed.',
      'Record freshness evidence in the stabilization report.',
    ];
  }
  if (target === 'copy_audit') {
    return [
      'Review the confusing phrase in desktop and mobile Browser QA.',
      'Replace technical or internal wording with public-facing copy.',
      'Add a frontend test if the copy is part of a stable workflow.',
    ];
  }
  return ['Decide whether the report becomes a test, documentation update, or discarded duplicate.'];
}

function parseMetadata(metadata: FeedbackExportRow['metadata']): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return { raw: metadata };
    }
  }
  return isRecord(metadata) ? metadata : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isKnownKind(kind: string): kind is FeedbackKind {
  return [
    'search_results',
    'course_result',
    'score',
    'external_link',
    'data_freshness',
    'copy_confusion',
    'other',
  ].includes(kind);
}

function isKnownIssue(issue: string): issue is FeedbackIssue {
  return [
    'expected_different_results',
    'missing_course',
    'wrong_score',
    'broken_link',
    'stale_data',
    'confusing_copy',
    'other',
  ].includes(issue);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error(usage());
    throw new Error('Missing --input');
  }

  const source = args.input;
  const input = args.input === '-' ? await readStdin() : await readFile(args.input, 'utf8');
  const rows = parseFeedbackExport(input);
  const report = buildFeedbackCandidateReport(rows, source);
  const body = `${JSON.stringify(report, null, 2)}\n`;

  if (args.output) {
    await writeFile(args.output, body);
  } else {
    process.stdout.write(body);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
