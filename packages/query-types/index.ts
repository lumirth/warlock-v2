export type QueryHintType =
  | "instructor"
  | "gened"
  | "subject"
  | "credits"
  | "term"
  | "level"
  | "levelBoost"
  | "course_code"
  | "crn"
  | "days"
  | "time"
  | "difficulty"
  | "online"
  | "status"
  | "negation"
  | "partOfTerm";

export interface QueryHint {
  type: QueryHintType;
  value: string | number | boolean | NegationValue | TermValue;
  confidence: number;
  isExplicit?: boolean;
  metadata?: Record<string, string>; // For course_code: { subject: 'CS', number: '225' }
}

export interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];
  residual: string;
}

export interface SearchFilters {
  // Entity filters
  instructor_ids?: number[];
  subject?: string;
  number?: string;
  crn?: string;
  gened_code?: string;
  gened_any?: string[]; // Course has ANY of these geneds
  gened_all?: string[]; // Course has ALL of these geneds

  // Schedule filters
  days?: string;
  time?: string; // morning, afternoon, evening, early, midday
  partOfTerm?: string; // A, B, 1, etc.

  // Attribute filters
  level?: number;
  credits?: number;
  online?: boolean;
  status?: string;
  difficulty?: "easy" | "hard";

  // Negations
  not?: {
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
  };

  // Term filters
  term?: string;
  year?: number;
}

export interface Ambiguity {
  term: string;
  chosen: { type: string; value: string; label: string };
  alternatives: { type: string; value: string; label: string }[];
}

export type DecisionQueryType =
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

export type RetrievalLane =
  | "exact"
  | "official_text"
  | "requirement"
  | "structured_section"
  | "student_language_alias"
  | "topic_semantic"
  | "workload_evidence"
  | "help_path";

export type SearchPlanWarningKind =
  | "student_profile_required"
  | "workload_evidence_incomplete"
  | "writing_evidence_incomplete"
  | "exam_evidence_incomplete"
  | "prereq_evidence_incomplete"
  | "math_risk_inferred";

export interface SearchPlanAssumption {
  kind: string;
  label: string;
  confidence: number;
  source: "rule" | "alias" | "fallback";
}

export interface SearchPlanWarning {
  kind: SearchPlanWarningKind;
  message: string;
  confidence: number;
}

export interface SearchRelaxationStep {
  id: string;
  label: string;
  relaxes: string[];
  keeps: string[];
}

export interface SearchPlanRescue {
  queryTypes: DecisionQueryType[];
  negativeTerms: string[];
  topicTerms: string[];
  expandedTerms: string[];
  assumptions: SearchPlanAssumption[];
  warnings: SearchPlanWarning[];
  retrievalLanes: RetrievalLane[];
  relaxationPlan: SearchRelaxationStep[];
  needsStudentProfile: boolean;
  confidence: number;
}

export type SearchRecoveryGroup = {
  id: string;
  label: string;
  description: string;
  relaxes: string[];
  keeps: string[];
  queryPatch?: {
    replaceQuery?: string;
    removeText?: string;
    appendText?: string;
  };
};

export interface SearchPlan {
  filters: SearchFilters;
  softPreferences?: Record<string, unknown>;
  intents?: SearchIntent[];
  semanticQuery: string;
  keywordQuery: string;
  ambiguities?: Ambiguity[];
  rescue?: SearchPlanRescue;
}

export type SearchIntent = "introductory_gateway" | "query_rescue";

// === NEW TYPES FOR UNIFIED QUERY SYSTEM ===

// Hint metadata with source tracking
export interface HintMetadata {
  source: "regex" | "alias" | "nlp" | "manual";
  span?: [number, number];
  confidence: number;
  raw: string;
}

// Rich hint structure
export interface Hint {
  type: HintType;
  value:
    | string
    | number
    | boolean
    | NegationValue
    | CourseCodeValue
    | TermValue;
  metadata: HintMetadata;
}

export type HintType =
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
  | "negation";

export interface NegationValue {
  target: HintType;
  value: string;
}

export interface CourseCodeValue {
  subject: string;
  number: string;
}

export interface TermValue {
  term: string;
  year: number;
}

// Suggestion for ambiguous terms
export interface Suggestion {
  text: string;
  action: "add_filter" | "remove_filter" | "change_filter";
  filter?: Partial<SearchFilters>;
}

// Parsed query from power-user syntax
export interface ParsedQuery {
  raw: string;
  clauses: ParsedClause[];
}

export interface ParsedClause {
  filters: FieldFilter[];
  negations: string[];
  phrases: string[];
  genedMode?: {
    any?: string[];
    all?: string[];
  };
  residual: string;
}

export interface FieldFilter {
  field: string;
  value: string;
  negated?: boolean;
}

export type InstructorLinkDto = {
  instructor_name: string | null;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  rmp_id: string | null;
  rmp_url?: string | null;
  rmp_search_url?: string | null;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
  num_ratings: number | null;
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
  course_explorer_url?: string;
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
  gened: string | null;
  year: number;
  term: string;
  primary_instructor: string | null;
  primary_instructor_rmp: number | null;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
  quality_score: number | null;
  difficulty_score: number | null;
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
  extraction: {
    hints: Hint[];
  };
  plan: SearchPlan;
  ambiguities?: Ambiguity[];
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

export type SearchChipDto = {
  id: string;
  type: HintType | "semantic" | "score" | "assumption" | "unknown";
  label: string;
  value: string;
  source: SearchChipSource;
  removable: boolean;
  editable: boolean;
  filter?: Partial<SearchFilters>;
  queryPatch?: {
    removeText?: string;
    appendText?: string;
    replaceQuery?: string;
  };
};

export type SearchAmbiguityActionDto = {
  id: string;
  term: string;
  label: string;
  filter: Partial<SearchFilters>;
  queryPatch?: {
    appendText?: string;
    replaceQuery?: string;
  };
};

export type AdvancedSearchStateDto = {
  subject?: string;
  number?: string;
  instructor?: string;
  term?: string;
  year?: number;
  gened?: string;
  credits?: number;
  days?: string;
  time?: string;
  online?: boolean;
  status?: string;
  difficulty?: "easy" | "hard";
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
