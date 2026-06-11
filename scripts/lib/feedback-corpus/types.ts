import type {
  FeedbackIssue,
  FeedbackKind,
  QueryFailureClass,
} from '@uiuc-course-search/query-types';

export type { FeedbackIssue, FeedbackKind };

export type PromotionTarget =
  | 'search_eval'
  | 'score_audit'
  | 'link_audit'
  | 'data_freshness_audit'
  | 'copy_audit'
  | 'manual_review';

export type CandidatePriority = 'high' | 'medium' | 'low';
type CandidateStatus = 'needs_review' | 'covered' | 'promoted' | 'dismissed';

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

export type SuggestedGoldQuery = {
  query: string;
  expected_filters: Record<string, unknown>;
  expected_filter_keys?: string[];
  category: 'navigational' | 'structured' | 'semantic' | 'instructor' | 'score' | 'schedule';
  notes: string;
};

export type FeedbackCorpusCandidate = {
  id: string;
  feedbackIds: string[];
  duplicateCount: number;
  target: PromotionTarget;
  priority: CandidatePriority;
  status: CandidateStatus;
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
  suggestedFailureClasses: QueryFailureClass[];
  suggestedGoldQuery?: SuggestedGoldQuery;
  reviewChecklist: string[];
  resolution?: {
    artifact: string;
    notes: string;
    reviewedAt?: string;
  };
};

export type FeedbackCandidateReport = {
  generated_at: string;
  source: string;
  row_count: number;
  candidate_count: number;
  needs_review_count: number;
  candidates: FeedbackCorpusCandidate[];
};

export type FeedbackCandidateResolution = {
  status: Exclude<CandidateStatus, 'needs_review'>;
  artifact: string;
  notes: string;
  reviewedAt?: string;
  target?: PromotionTarget;
  kind?: FeedbackKind;
  issue?: FeedbackIssue;
  query?: string;
  expected?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  crn?: string;
  instructorName?: string;
  scoreField?: string;
};
