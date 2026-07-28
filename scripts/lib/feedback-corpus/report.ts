import {
  buildReviewChecklist,
  inferFailureClasses,
} from './classification.js';
import { buildSuggestedGoldQuery } from './gold-query.js';
import type {
  CandidatePriority,
  FeedbackCandidateReport,
  FeedbackCandidateResolution,
  FeedbackCorpusCandidate,
  FeedbackExportRow,
  FeedbackIssue,
  FeedbackKind,
  PromotionTarget,
} from './types.js';

export type {
  FeedbackCandidateReport,
  FeedbackCandidateResolution,
  FeedbackCorpusCandidate,
  FeedbackExportRow,
} from './types.js';

const SEARCH_EVAL_ISSUES: ReadonlySet<FeedbackIssue> = new Set([
  'expected_different_results',
  'missing_course',
]);

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

export function parseFeedbackResolutionLedger(text: string): FeedbackCandidateResolution[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.resolutions)
      ? parsed.resolutions
      : [];

  return rows
    .filter(isRecord)
    .map(row => normalizeResolution(row))
    .filter((resolution): resolution is FeedbackCandidateResolution => resolution !== null);
}

export function buildFeedbackCandidateReport(
  rows: FeedbackExportRow[],
  source: string,
  now = new Date(),
  resolutions: FeedbackCandidateResolution[] = []
): FeedbackCandidateReport {
  const candidates = applyResolutions(dedupeCandidates(rows
    .map((row, index) => buildCandidate(row, index))
    .filter((candidate): candidate is FeedbackCorpusCandidate => candidate !== null)), resolutions);

  return {
    generated_at: now.toISOString(),
    source,
    row_count: rows.length,
    candidate_count: candidates.length,
    needs_review_count: candidates.filter(candidate => candidate.status === 'needs_review').length,
    candidates,
  };
}

function normalizeResolution(row: Record<string, unknown>): FeedbackCandidateResolution | null {
  const status = optionalString(row.status);
  const artifact = optionalString(row.artifact);
  const notes = optionalString(row.notes);
  if (!isResolutionStatus(status) || !artifact || !notes) {
    return null;
  }

  const target = optionalString(row.target);
  const kind = optionalString(row.kind);
  const issue = optionalString(row.issue);

  return {
    status,
    artifact,
    notes,
    reviewedAt: optionalString(row.reviewedAt),
    target: isPromotionTarget(target) ? target : undefined,
    kind: kind && isKnownKind(kind) ? kind : undefined,
    issue: issue && isKnownIssue(issue) ? issue : undefined,
    query: optionalString(row.query),
    expected: optionalString(row.expected),
    courseId: optionalString(row.courseId) ?? optionalString(row.course_id),
    subject: optionalString(row.subject)?.toUpperCase(),
    number: optionalString(row.number),
    term: optionalString(row.term)?.toLowerCase(),
    year: optionalInteger(row.year),
    crn: optionalString(row.crn),
    instructorName: optionalString(row.instructorName) ?? optionalString(row.instructor_name),
    scoreField: normalizeScoreField(optionalString(row.scoreField) ?? optionalString(row.score_field)),
  };
}

function applyResolutions(
  candidates: FeedbackCorpusCandidate[],
  resolutions: FeedbackCandidateResolution[]
): FeedbackCorpusCandidate[] {
  if (resolutions.length === 0) return candidates;

  return candidates.map(candidate => {
    const resolution = resolutions.find(item => resolutionMatchesCandidate(item, candidate));
    if (!resolution) return candidate;

    return {
      ...candidate,
      status: resolution.status,
      resolution: {
        artifact: resolution.artifact,
        notes: resolution.notes,
        reviewedAt: resolution.reviewedAt,
      },
    };
  });
}

function resolutionMatchesCandidate(
  resolution: FeedbackCandidateResolution,
  candidate: FeedbackCorpusCandidate
): boolean {
  const exactFields: (keyof FeedbackCandidateResolution & keyof FeedbackCorpusCandidate)[] = [
    'target',
    'kind',
    'issue',
    'query',
    'expected',
    'courseId',
    'subject',
    'number',
    'term',
    'crn',
    'instructorName',
    'scoreField',
  ];

  for (const field of exactFields) {
    const expected = resolution[field];
    if (expected === undefined) continue;
    if (normalizeKeyPart(String(candidate[field] ?? '')) !== normalizeKeyPart(String(expected))) {
      return false;
    }
  }

  return resolution.year === undefined || candidate.year === resolution.year;
}

function buildCandidate(row: FeedbackExportRow, index: number): FeedbackCorpusCandidate | null {
  if (!isKnownKind(row.kind) || !isKnownIssue(row.issue)) {
    return null;
  }

  const normalized = normalizeRow(row);
  const target = getPromotionTarget(normalized);
  const query = normalized.query || buildQueryFromCourseFields(normalized);
  const metadata = parseMetadata(normalized.metadata);
  const suggestedFailureClasses = inferFailureClasses({
    ...normalized,
    query,
    metadata,
    target,
  });
  const candidate: FeedbackCorpusCandidate = {
    id: normalized.id || `feedback-row-${index + 1}`,
    feedbackIds: [normalized.id || `feedback-row-${index + 1}`],
    duplicateCount: 1,
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
    suggestedFailureClasses,
    reviewChecklist: buildReviewChecklist(target),
  };

  if (target === 'search_eval' && query) {
    candidate.suggestedGoldQuery = buildSuggestedGoldQuery(candidate);
  }

  return candidate;
}

function dedupeCandidates(candidates: FeedbackCorpusCandidate[]): FeedbackCorpusCandidate[] {
  const byKey = new Map<string, FeedbackCorpusCandidate>();

  for (const candidate of candidates) {
    const key = dedupeKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }

    existing.duplicateCount += candidate.duplicateCount;
    existing.feedbackIds.push(...candidate.feedbackIds);
    if (!existing.message && candidate.message) existing.message = candidate.message;
    if (!existing.expected && candidate.expected) existing.expected = candidate.expected;
    if (!existing.createdAt || (candidate.createdAt && candidate.createdAt > existing.createdAt)) {
      existing.createdAt = candidate.createdAt;
    }
  }

  return Array.from(byKey.values());
}

function dedupeKey(candidate: FeedbackCorpusCandidate): string {
  return [
    candidate.target,
    candidate.kind,
    candidate.issue,
    normalizeKeyPart(candidate.query),
    normalizeKeyPart(candidate.expected),
    normalizeKeyPart(candidate.courseId),
    normalizeKeyPart(candidate.subject),
    normalizeKeyPart(candidate.number),
    normalizeKeyPart(candidate.term),
    String(candidate.year ?? ''),
    normalizeKeyPart(candidate.crn),
    normalizeKeyPart(candidate.instructorName),
    normalizeKeyPart(candidate.scoreField),
  ].join('|');
}

function normalizeKeyPart(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function normalizeScoreField(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized === 'difficulty' || normalized === 'workload'
    ? 'instructor_difficulty'
    : normalized;
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
    scoreField: normalizeScoreField(optionalString(row.scoreField) ?? optionalString(row.score_field)),
    expected: optionalString(row.expected),
    message: optionalString(row.message),
    metadata: row.metadata,
    createdAt: optionalInteger(row.createdAt) ?? optionalInteger(row.created_at),
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

function buildQueryFromCourseFields(row: ReturnType<typeof normalizeRow>): string | undefined {
  if (row.subject && row.number) return `${row.subject} ${row.number}`;
  if (row.crn) return `CRN ${row.crn}`;
  if (row.subject) return row.subject;
  return undefined;
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

function isPromotionTarget(target: string | undefined): target is PromotionTarget {
  return [
    'search_eval',
    'score_audit',
    'link_audit',
    'data_freshness_audit',
    'copy_audit',
    'manual_review',
  ].includes(target ?? '');
}

function isResolutionStatus(status: string | undefined): status is FeedbackCandidateResolution['status'] {
  return ['covered', 'promoted', 'dismissed'].includes(status ?? '');
}
