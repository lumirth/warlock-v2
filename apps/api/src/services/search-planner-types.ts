import type {
  RequirementFilter,
  SearchInstructorDifficultyFilter,
  SearchLevelFilter,
  SearchSort,
  SearchStatusFilter,
  SearchTermFilter,
  SearchTimeFilter,
} from "@uiuc-course-search/query-types";

export interface SearchFilters {
  instructor_ids?: number[];
  subject?: string;
  number?: string;
  crn?: string;
  requirement?: RequirementFilter;
  days?: string;
  time?: SearchTimeFilter;
  partOfTerm?: string;
  compressedTerm?: boolean;
  startAfterMinutes?: number;
  startBeforeMinutes?: number;
  level?: SearchLevelFilter;
  credits?: number;
  online?: boolean;
  status?: SearchStatusFilter;
  instructorDifficulty?: SearchInstructorDifficultyFilter;
  not?: {
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
    subjects?: string[];
    requirementCodes?: string[];
    keywords?: string[];
  };
  term?: SearchTermFilter;
  year?: number;
}

export interface Ambiguity {
  term: string;
  chosen: { type: string; value: string; label: string };
  alternatives: { type: string; value: string; label: string }[];
}

export type SearchIntentKind =
  | "exact_course"
  | "requirement"
  | "schedule"
  | "topic"
  | "subjective_vibe"
  | "avoidance"
  | "eligibility"
  | "degree_progress"
  | "comparison";

export type SearchPlanWarningKind =
  | "student_profile_required"
  | "workload_evidence_incomplete"
  | "writing_evidence_incomplete"
  | "exam_evidence_incomplete"
  | "prereq_evidence_incomplete"
  | "math_risk_inferred";

export interface SearchPlanWarning {
  kind: SearchPlanWarningKind;
  message: string;
  confidence: number;
}

export interface SearchIntent {
  queryTypes: SearchIntentKind[];
  negativeTerms: string[];
  topicTerms: string[];
  expandedTerms: string[];
  warnings: SearchPlanWarning[];
  confidence: number;
}

export type SearchSoftPreferences = {
  lowWriting?: number;
  lowReading?: number;
  lowMath?: number;
  lowExams?: number;
  fun?: number;
  nonMajorFriendly?: number;
  noListedPrereq?: boolean;
  levelBoost?: number;
  topicExpansions?: string[];
  inferredSort?: SearchSort;
};

export interface SearchPlan {
  filters: SearchFilters;
  softPreferences?: SearchSoftPreferences;
  introductoryGateway?: true;
  semanticQuery: string;
  keywordQuery: string;
  ambiguities?: Ambiguity[];
  intent?: SearchIntent;
}

export interface HintMetadata {
  source: "regex" | "alias" | "nlp";
  span?: [number, number];
  confidence: number;
  raw: string;
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
  | "requirement"
  | "term"
  | "partOfTerm"
  | "negation";

export type HintValueByType = {
  courseCode: CourseCodeValue;
  crn: string;
  subject: string;
  instructor: string;
  days: string;
  time: SearchTimeFilter;
  level: SearchLevelFilter;
  levelBoost: number;
  credits: number;
  online: boolean;
  status: SearchStatusFilter;
  requirement: string;
  term: TermValue;
  partOfTerm: string;
  negation: NegationValue;
};

export type Hint = {
  [K in HintType]: {
    type: K;
    value: HintValueByType[K];
    metadata: HintMetadata;
  }
}[HintType];

interface NegationValue {
  target: HintType | "keyword" | "workload";
  value: string;
}

interface CourseCodeValue {
  subject: string;
  number: string;
}

interface TermValue {
  term: SearchTermFilter;
  year: number;
}

export interface ParsedQuery {
  filters: FieldFilter[];
  negations: string[];
  phrases: string[];
  requirementMode?: {
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
