import type { CourseRequirementDto } from "@uiuc-course-search/query-types";
import type { Course } from '../db/types.js';

export type RetrievalLane =
  | "exact"
  | "official_text"
  | "structured_course"
  | "section_text"
  | "topic_semantic";

type RankingScoreComponentName =
  | "retrieval_fusion"
  | "title_match"
  | "topic_title_match"
  | "exactness"
  | "quality_tier"
  | "requirement_match"
  | "introductory_gateway"
  | "level_accessibility"
  | "workload_preference"
  | "eligibility"
  | "negative_preference_penalty"
  | "null_data_penalty"
  | "term_tie_breaker"
  | "attribute_sort";

export interface RankingScoreComponent {
  name: RankingScoreComponentName;
  value: number;
  reason: string;
  evidence?: string[];
}

export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  laneMatches?: RetrievalLane[];
  laneRanks?: Partial<Record<RetrievalLane, number>>;
  requirements?: CourseRequirementDto[];
  laneResults?: RetrievalLaneResult[];
  scoreComponents?: RankingScoreComponent[];
  termPriority?: number;
  historical?: boolean;
}

export interface RetrievalLaneResult {
  id: string;
  lane: RetrievalLane;
  rank: number;
  rawScore?: number;
  matchedTerms?: string[];
  evidence?: string[];
  reason: string;
}
