import type { RetrievalLane } from "./search-planner-types.js";
import type { Course } from '../db/types.js';

export type RankingScoreComponentName =
  | "retrieval_fusion"
  | "title_match"
  | "exactness"
  | "quality_tier"
  | "requirement_match"
  | "availability_term"
  | "student_language"
  | "workload_evidence"
  | "introductory_gateway"
  | "level_accessibility"
  | "workload_preference"
  | "eligibility"
  | "negative_preference_penalty"
  | "null_data_penalty"
  | "term_tie_breaker";

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
  supportedSubjectiveClaims?: string[];
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
