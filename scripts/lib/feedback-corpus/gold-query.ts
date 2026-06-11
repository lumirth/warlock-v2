import { mentionsSchedule } from './classification.js';
import type {
  FeedbackCorpusCandidate,
  SuggestedGoldQuery,
} from './types.js';

export function buildSuggestedGoldQuery(
  candidate: FeedbackCorpusCandidate,
): SuggestedGoldQuery {
  const expectedFilters: Record<string, unknown> = {};
  const expectedFilterKeys = new Set<string>();
  const notes: string[] = [
    `Promoted from feedback ${candidate.id}. Review before adding to GOLDEN_QUERIES.`,
  ];

  if (candidate.subject) expectedFilters.subject = candidate.subject;
  if (candidate.number) expectedFilters.number = candidate.number;
  if (candidate.crn) expectedFilters.crn = candidate.crn;
  if (candidate.term) expectedFilters.term = candidate.term;
  if (candidate.year) expectedFilters.year = candidate.year;

  if (hasInstructorExpectation(candidate)) {
    expectedFilterKeys.add('instructor_ids');
    notes.push(
      'Instructor IDs depend on database rows; keep expected_filter_keys unless a stable instructor fixture exists.',
    );
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
    category,
    notes: notes.join(' '),
  };
}

function inferGoldCategory(
  candidate: FeedbackCorpusCandidate,
): SuggestedGoldQuery['category'] {
  if (hasInstructorExpectation(candidate)) return 'instructor';
  if (candidate.scoreField || candidate.issue === 'wrong_score') return 'score';
  if (candidate.crn || (candidate.subject && candidate.number)) return 'navigational';
  if (mentionsSchedule(candidate)) return 'schedule';
  if (candidate.subject || candidate.term || candidate.year) return 'structured';
  return 'semantic';
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
