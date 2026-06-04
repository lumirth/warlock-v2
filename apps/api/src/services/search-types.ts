import type { RetrievalLane } from "@uiuc-course-search/query-types/search-planner";
import type { Course } from '../db/types.js';

export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  laneMatches?: RetrievalLane[];
  laneRanks?: Partial<Record<RetrievalLane, number>>;
  supportedSubjectiveClaims?: string[];
  termPriority?: number;
  historical?: boolean;
}
