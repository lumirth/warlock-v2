import type { QueryFailureClass } from '@uiuc-course-search/query-types';
import type { PromotionTarget } from './types.js';

export type FeedbackClassificationInput = {
  query?: string;
  expected?: string;
  message?: string;
  instructorName?: string;
  subject?: string;
  number?: string;
  scoreField?: string;
  metadata?: Record<string, unknown>;
  target: PromotionTarget;
};

export function inferFailureClasses(
  candidate: FeedbackClassificationInput,
): QueryFailureClass[] {
  const classes = new Set<QueryFailureClass>();
  const haystack = [
    candidate.query,
    candidate.expected,
    candidate.message,
    candidate.instructorName,
  ].filter(Boolean).join(' ');

  if (
    (candidate.subject && candidate.number)
    || /\b[A-Z]{2,4}\s*\d{3}\b/i.test(haystack)
    || /\bCRN\s*\d{5}\b/i.test(haystack)
  ) {
    classes.add('course_code_navigation');
  }

  if (
    candidate.subject
    || /\b(comp sci|computer science|psychology|statistics|economics|spanish|mathematics)\b/i.test(haystack)
  ) {
    classes.add('subject_alias');
  }

  if (/\b(intro|introductory|beginner)\b/i.test(haystack)) {
    if (
      candidate.subject
      || /\b(comp sci|computer science|spanish|math|mathematics|psychology)\b/i.test(haystack)
    ) {
      classes.add('introductory_gateway');
    } else {
      classes.add('topical_intro');
    }
  }

  if (
    /\b(professor|prof|instructor|taught by|with|dr\.?)\b/i.test(haystack)
    || candidate.instructorName
  ) {
    classes.add('instructor_name');
  }

  if (
    /\b(gen\s*ed|gened|humanities|natural sciences|cultural studies|quantitative reasoning|advanced composition|writing intensive)\b/i.test(haystack)
  ) {
    classes.add('requirement_language');
  }

  if (mentionsSchedule(candidate)) {
    classes.add('schedule_delivery');
  }

  if (
    candidate.target === 'score_audit'
    || candidate.scoreField
    || /\b(easy|hard|difficulty|workload|gpa|quality|rating|booster)\b/i.test(haystack)
  ) {
    classes.add('score_quality');
  }

  if (
    /\b[a-z_]+:[^\s]+/i.test(haystack)
    || /"[^"]+"/.test(haystack)
    || /\s-\w+/.test(haystack)
  ) {
    classes.add('power_syntax');
  }

  if (
    /\b(CS|PS)\b.*\b(gen\s*ed|gened|cultural studies|physical sciences)\b/i.test(haystack)
  ) {
    classes.add('ambiguity');
  }

  if (/\b(sort by|campus:|no exams|avoid|not )\b/i.test(haystack)) {
    classes.add('unsupported_language');
  }

  if (classes.size === 0 && candidate.target === 'search_eval' && candidate.query) {
    classes.add('semantic_topic');
  }

  return Array.from(classes).sort();
}

export function mentionsSchedule(candidate: {
  query?: string;
  expected?: string;
  message?: string;
}): boolean {
  const haystack = [candidate.query, candidate.expected, candidate.message]
    .filter(Boolean)
    .join(' ');
  return /\b(MWF|TR|morning|afternoon|evening|online|in person|credits?)\b/i
    .test(haystack);
}

export function buildReviewChecklist(target: PromotionTarget): string[] {
  if (target === 'search_eval') {
    return [
      'Reproduce the reported query locally or on staging.',
      'Confirm the expected result or expected filters with Course Explorer data.',
      'Confirm the suggested corpus failure classes or assign a better class before promotion.',
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
      'Record freshness evidence in the maintenance evidence file for the run.',
    ];
  }
  if (target === 'copy_audit') {
    return [
      'Review the confusing phrase in desktop and mobile Browser QA.',
      'Replace technical or internal wording with public-facing copy.',
      'Add a frontend test if the copy is part of a stable workflow.',
    ];
  }
  return [
    'Decide whether the report becomes a test, documentation update, or discarded duplicate.',
  ];
}
