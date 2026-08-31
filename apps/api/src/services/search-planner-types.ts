import type {
  RequirementFilter,
  SearchChipType,
  SearchInstructorDifficultyFilter,
  SearchLevelFilter,
  SearchSort,
  SearchStatusFilter,
  SearchTermFilter,
  SearchTimeFilter,
} from "@uiuc-course-search/query-types";

/** The one executable representation shared by planning, SQL, and ranking. */
export type SearchFilters = {
  subject?: string;
  number?: string;
  crn?: string;
  instructor_ids?: number[];
  requirement?: RequirementFilter;
  credits?: number;
  days?: string;
  time?: SearchTimeFilter;
  partOfTerm?: string;
  compressedTerm?: boolean;
  startAfterMinutes?: number;
  startBeforeMinutes?: number;
  level?: SearchLevelFilter;
  online?: boolean;
  status?: SearchStatusFilter;
  instructorDifficulty?: SearchInstructorDifficultyFilter;
  term?: SearchTermFilter;
  year?: number;
  not?: {
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
    subjects?: string[];
    requirementCodes?: string[];
    keywords?: string[];
  };
};

export type SearchPlan = {
  filters: SearchFilters;
  keywordQuery: string;
  introductoryGateway?: true;
  softPreferences?: {
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
  ambiguities?: Array<{
    term: string;
    alternatives: Array<{ type: string; value: string; label: string }>;
  }>;
};

type HintValues = {
  courseCode: { subject: string; number: string };
  crn: string;
  subject: string;
  instructor: string;
  days: string;
  time: SearchTimeFilter | string;
  level: SearchLevelFilter;
  levelBoost: number;
  credits: number;
  online: boolean;
  status: SearchStatusFilter;
  instructorDifficulty: SearchInstructorDifficultyFilter;
  requirement: RequirementFilter | string;
  term: { term: SearchTermFilter; year?: number };
  partOfTerm: string;
  negation: { target: string; value: string };
  topic: string;
};
type HintMetadata = {
  source: "regex" | "alias" | "nlp" | "request";
  raw: string;
};
export type Hint = {
  [K in SearchChipType]: { type: K; value: HintValues[K]; metadata: HintMetadata }
}[SearchChipType];
