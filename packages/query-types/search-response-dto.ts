import type { SearchCourseResultDto } from "./course-dto.js";
import type { SearchRequestDto, SearchScope, SearchSort } from "./search-contract.js";

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

export type SearchInterpretationEvidenceLane =
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
  /** Student-facing evidence categories implied by the query, not executable retrieval config. */
  evidenceLanes: SearchInterpretationEvidenceLane[];
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
  | "workload"
  | "requirement"
  | "term"
  | "partOfTerm"
  | "negation"
  | "semantic"
  | "score"
  | "assumption"
  | "unknown";

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
  /**
   * Lossless executable continuation request. Clients may send this request back
   * for sort, pagination, and refresh operations without reinterpreting server
   * planning state.
   */
  nextRequest: SearchRequestDto;
  /**
   * Display-oriented interpretation of the request after natural-language
   * planning. This may intentionally drop executable text and is not a
   * continuation request.
   */
  interpretedRequest?: SearchRequestDto;
  term?: {
    activeTermId: string | null;
    registrableTermId: string | null;
    activeTermIds?: string[];
    registrableTermIds?: string[];
  };
  ui?: SearchUiPlanDto;
};

export type SearchResponseDto = {
  results: SearchCourseResultDto[];
  meta: SearchMetaDto;
  pagination: {
    totalResults: number;
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
  ambiguityActions: SearchAmbiguityActionDto[];
};
