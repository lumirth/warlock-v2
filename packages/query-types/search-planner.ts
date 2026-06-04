import type { RequirementFilter } from "./course-policy.js";
import type {
  SearchRequestFiltersDto,
  SearchSort,
} from "./search-contract.js";

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
  metadata?: Record<string, string>;
}

export interface ExtractedQuery {
  rawQuery: string;
  hints: QueryHint[];
  residual: string;
}

export interface SearchFilters {
  instructor_ids?: number[];
  subject?: string;
  number?: string;
  crn?: string;
  requirement?: RequirementFilter;
  days?: string;
  time?: string;
  partOfTerm?: string;
  level?: number;
  credits?: number;
  online?: boolean;
  status?: string;
  difficulty?: "easy" | "hard";
  not?: {
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
    subjects?: string[];
    geneds?: string[];
    keywords?: string[];
  };
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
  | "section_text"
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
  /** Explanatory lane hints inferred from intent. Executable lanes live in RetrievalPlan. */
  interpretedLanes: RetrievalLane[];
  relaxationPlan: SearchRelaxationStep[];
  needsStudentProfile: boolean;
  confidence: number;
}

export type SearchSoftPreferences = {
  easy?: number;
  lowWriting?: number;
  lowReading?: number;
  lowMath?: number;
  lowBiology?: number;
  lowExams?: number;
  lowWorkload?: number;
  lowGroupWork?: number;
  fun?: number;
  practical?: number;
  asyncFriendly?: number;
  nonMajorFriendly?: number;
  noListedPrereq?: boolean;
  compressedTerm?: boolean;
  startAfterMinutes?: number;
  startBeforeMinutes?: number;
  levelBoost?: number | "introductory";
  introductoryIntent?: "gateway";
  topicExpansions?: string[];
  inferredSort?: SearchSort;
};

export interface SearchPlan {
  rawQuery?: string;
  filters: SearchFilters;
  softPreferences?: SearchSoftPreferences;
  intents?: SearchIntent[];
  semanticQuery: string;
  keywordQuery: string;
  ambiguities?: Ambiguity[];
  rescue?: SearchPlanRescue;
}

export type SearchIntent = "introductory_gateway" | "query_rescue";

export interface HintMetadata {
  source: "regex" | "alias" | "nlp" | "manual";
  span?: [number, number];
  confidence: number;
  raw: string;
}

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
  target: HintType | "keyword" | "workload";
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

export interface Suggestion {
  text: string;
  action: "add_filter" | "remove_filter" | "change_filter";
  filter?: Partial<SearchRequestFiltersDto>;
}

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
