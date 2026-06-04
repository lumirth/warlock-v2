import type {
  AdvancedSearchStateDto,
  SearchScope,
  SearchSort,
  SearchRequestDto,
} from "./search-contract.js";

export * from "./course-policy.js";
export * from "./search-contract.js";

export type SearchInterpretationQueryType =
  | "exact_course"
  | "requirement"
  | "schedule"
  | "topic"
  | "subjective_vibe"
  | "avoidance"
  | "eligibility"
  | "degree_progress"
  | "comparison"
  | "help_or_how_to";

export type SearchInterpretationRetrievalLane =
  | "exact"
  | "official_text"
  | "requirement"
  | "section_text"
  | "structured_section"
  | "student_language_alias"
  | "topic_semantic"
  | "workload_evidence"
  | "help_path";

export type SearchInterpretationWarningKind =
  | "student_profile_required"
  | "workload_evidence_incomplete"
  | "writing_evidence_incomplete"
  | "exam_evidence_incomplete"
  | "prereq_evidence_incomplete"
  | "math_risk_inferred";

export type SearchInterpretationAssumptionDto = {
  kind: string;
  label: string;
  confidence: number;
  source: "rule" | "alias" | "fallback";
};

export type SearchInterpretationWarningDto = {
  kind: SearchInterpretationWarningKind;
  message: string;
  confidence: number;
};

export type SearchInterpretationRelaxationStepDto = {
  id: string;
  label: string;
  relaxes: string[];
  keeps: string[];
};

export type SearchRecoveryGroup = {
  id: string;
  label: string;
  description: string;
  relaxes: string[];
  keeps: string[];
  action: SearchActionDto;
};

export type SearchInterpretationDto = {
  queryTypes: SearchInterpretationQueryType[];
  negativeTerms: string[];
  topicTerms: string[];
  expandedTerms: string[];
  assumptions: SearchInterpretationAssumptionDto[];
  warnings: SearchInterpretationWarningDto[];
  /** Student-facing interpretation of useful evidence lanes, not executable retrieval config. */
  retrievalLanes: SearchInterpretationRetrievalLane[];
  relaxationPlan: SearchInterpretationRelaxationStepDto[];
  needsStudentProfile: boolean;
  confidence: number;
};

export type SearchChipType =
  | "courseCode"
  | "crn"
  | "subject"
  | "instructor"
  | "days"
  | "time"
  | "level"
  | "levelBoost"
  | "credits"
  | "online"
  | "status"
  | "difficulty"
  | "gened"
  | "term"
  | "partOfTerm"
  | "negation"
  | "semantic"
  | "score"
  | "assumption"
  | "unknown";

export type InstructorLinkDto = {
  instructor_name: string | null;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  rmp_id: string | null;
  rmp_url?: string | null;
  rmp_search_url?: string | null;
  avg_gpa: number | null;
  median_gpa: number | null;
  gpa_sample_size: number | null;
  num_ratings: number | null;
  would_take_again_pct: number | null;
  top_tags: string[] | null;
  department: string | null;
};

export type CourseSectionMeetingDto = {
  typeCode: string | null;
  typeName: string | null;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  buildingName: string | null;
  roomNumber: string | null;
  dateRangeText: string | null;
  instructorNames: string[];
  instructors: InstructorLinkDto[];
};

export type CourseSectionDto = {
  crn: string;
  sectionNumber: string;
  status: string;
  type: string;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  instructor: string;
  instructorRmp: number | null;
  instructorGpa: number | null;
  instructorStats: InstructorLinkDto[];
  sectionTitle: string | null;
  statusCode: string | null;
  sectionStatusCode: string | null;
  sectionText: string | null;
  sectionNotes: string | null;
  cappArea: string | null;
  dateRangeText: string | null;
  partOfTerm: string | null;
  startDate: string | null;
  endDate: string | null;
  creditHours: string | null;
  meetings: CourseSectionMeetingDto[];
  course_explorer_url?: string;
};

export type CourseGenedDto = {
  categoryId: string;
  categoryName: string | null;
  attributeCode: string | null;
  attributeName: string | null;
};

export type MatchEvidenceKind =
  | "course_code"
  | "subject"
  | "number"
  | "crn"
  | "title"
  | "gened"
  | "schedule"
  | "delivery"
  | "instructor"
  | "alias"
  | "workload"
  | "topic"
  | "semantic"
  | "keyword"
  | "difficulty"
  | "quality"
  | "term";

export type MatchEvidenceSource =
  | "filter"
  | "query"
  | "keyword"
  | "semantic"
  | "alias"
  | "signal"
  | "metadata"
  | "term";

export type MatchEvidenceWeight = "hard" | "soft" | "rank";

export type MatchEvidence = {
  kind: MatchEvidenceKind;
  label: string;
  value?: string;
  source: MatchEvidenceSource;
  weight: MatchEvidenceWeight;
};

export type ResultWarningKind = "historical" | "cached" | "stale" | "partial";

export type ResultWarning = {
  kind: ResultWarningKind;
  message: string;
};

export type SectionMatchDto = {
  crn: string;
  sectionNumber: string;
  evidence: MatchEvidence[];
};

export type ResultExplanation = {
  whyMatched: string[];
  watchOut: string[];
  matchedChips: string[];
  confidence: {
    score: number;
    label: "high" | "medium" | "low" | "uncertain";
    reasons: string[];
  };
};

export type CourseDto = {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  credit_hours: number | null;
  year: number;
  term: string;
  primary_instructor: string | null;
  primary_instructor_rmp: number | null;
  avg_gpa: number | null;
  median_gpa: number | null;
  gpa_sample_size: number | null;
  quality_score: number | null;
  difficulty_score: number | null;
  course_info: string | null;
  degree_attributes: string | null;
  class_schedule_info: string | null;
  date_range_text: string | null;
  registration_notes: string | null;
  approval_code: string | null;
  geneds: CourseGenedDto[];
  instructor_links: Record<string, InstructorLinkDto>;
  course_explorer_url?: string;
  sections?: CourseSectionDto[];
  _score?: number;
  _semanticRank?: number;
  _keywordRank?: number;
  _historical?: boolean;
  _cached?: boolean;
  _stale?: boolean;
  _stale_reason?: string | null;
  _age_seconds?: number;
  _fetched_at?: number;
  _term_status?: string;
  match_evidence?: MatchEvidence[];
  explanation?: ResultExplanation;
  warnings?: ResultWarning[];
  section_matches?: SectionMatchDto[];
};

export type SearchMetaDto = {
  query: {
    raw: string;
    residual: string;
  };
  interpretation?: SearchInterpretationDto;
  timing: {
    extraction_ms: number;
    search_ms: number;
    total_ms: number;
  };
  fallback?: {
    tierReached: number;
    constraintsRelaxed: string[];
    originalResultCount: number;
    recoveryGroups?: SearchRecoveryGroup[];
  };
  appliedSort?: SearchSort;
  appliedScope?: SearchScope;
  term?: {
    activeTermId: string | null;
    registrableTermId: string | null;
    activeTermIds?: string[];
    registrableTermIds?: string[];
  };
  ui?: SearchUiPlanDto;
};

export type SearchResponseDto = {
  results: CourseDto[];
  meta: SearchMetaDto;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore?: boolean;
    nextOffset?: number | null;
  };
};

export type SearchChipSource =
  | "natural_language"
  | "advanced_control"
  | "ambiguity"
  | "manual_override";

export type SearchActionDto = {
  kind: "run_search";
  nextRequest: SearchRequestDto;
};

export type SearchChipDto = {
  id: string;
  type: SearchChipType;
  label: string;
  value: string;
  source: SearchChipSource;
  removable: boolean;
  editable: boolean;
  action?: SearchActionDto;
};

export type SearchAmbiguityActionDto = {
  id: string;
  term: string;
  label: string;
  action: SearchActionDto;
};

export type SearchUiPlanDto = {
  chips: SearchChipDto[];
  advanced: AdvancedSearchStateDto;
  ambiguityActions: SearchAmbiguityActionDto[];
};

export type FeedbackKind =
  | "search_results"
  | "course_result"
  | "score"
  | "external_link"
  | "data_freshness"
  | "copy_confusion"
  | "other";

export type FeedbackIssue =
  | "expected_different_results"
  | "missing_course"
  | "wrong_score"
  | "broken_link"
  | "stale_data"
  | "confusing_copy"
  | "other";

export type FeedbackSubmitDto = {
  kind: FeedbackKind;
  issue: FeedbackIssue;
  page: "search" | "course";
  query?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  crn?: string;
  instructorName?: string;
  scoreField?: "quality" | "difficulty" | "gpa" | "rmp";
  expected?: string;
  message?: string;
  anonymousSessionId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type FeedbackResponseDto = {
  id: string;
  status: "accepted";
  received_at: number;
};

export const COURSE_EXPLORER_BASE_URL = "https://courses.illinois.edu";
export const RATE_MY_PROFESSORS_BASE_URL = "https://www.ratemyprofessors.com";
export const UIUC_RMP_SCHOOL_ID = "1112";

export type CourseExplorerUrlInput = {
  year: number;
  term: string;
  subject: string;
  number: string;
};

export function buildCourseExplorerCourseUrl(
  input: CourseExplorerUrlInput,
): string {
  const year = String(input.year);
  const term = input.term.toLowerCase();
  const subject = input.subject.toUpperCase();
  const number = input.number;

  return `${COURSE_EXPLORER_BASE_URL}/schedule/${encodeURIComponent(year)}/${encodeURIComponent(term)}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`;
}

export function buildCourseExplorerSectionUrl(
  input: CourseExplorerUrlInput & { crn: string },
): string {
  return buildCourseExplorerCourseUrl(input);
}

export function buildRmpProfessorUrl(
  rmpId: string | null | undefined,
): string | null {
  if (!rmpId || !/^[0-9]+$/.test(rmpId)) {
    return null;
  }

  return `${RATE_MY_PROFESSORS_BASE_URL}/professor/${encodeURIComponent(rmpId)}`;
}

export function buildRmpSearchUrl(
  instructorName: string | null | undefined,
): string | null {
  const normalized = instructorName?.trim();
  if (!normalized) {
    return null;
  }

  return `${RATE_MY_PROFESSORS_BASE_URL}/search/professors/${UIUC_RMP_SCHOOL_ID}?q=${encodeURIComponent(normalized)}`;
}
