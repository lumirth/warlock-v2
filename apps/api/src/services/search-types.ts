import type {
  CourseRegistrationSummaryDto,
  CourseRequirementDto,
  SearchScope,
  SearchSort,
} from "@uiuc-course-search/query-types";
import type { Course } from "../db/types.js";
import type { Hint, SearchPlan } from "./search-planner-types.js";

export type RetrievalLane =
  | "exact"
  | "official_text"
  | "structured_course"
  | "section_text"
  | "topic_semantic";

export type SearchResult = {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  requirements?: CourseRequirementDto[];
  registrationSummary?: CourseRegistrationSummaryDto;
  termPriority?: number;
  historical?: boolean;
};

export type SearchPipelineResult = {
  results: SearchResult[];
  totalResults: number;
  meta: {
    query: { residual: string };
    hints: Hint[];
    plan: SearchPlan;
    controls: { sort: SearchSort; scope: SearchScope };
    lanes: RetrievalLane[];
    failedLanes: RetrievalLane[];
  };
};
