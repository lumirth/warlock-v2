import {
  getQualityTierRank,
  getInstructorDifficultyTierRank,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { SearchResult } from "../search-types.js";
import { parseCourseNumberForSort } from "./ranking-text.js";

export function sortValueForResult(
  result: SearchResult,
  field: SearchSort["field"],
): number | null {
  const course = result.course;

  switch (field) {
    case "gpa":
      return typeof course.avg_gpa === "number" ? course.avg_gpa : null;
    case "quality":
      return getQualityTierRank(course.quality_score);
    case "instructor_difficulty":
      return getInstructorDifficultyTierRank(course.difficulty_score);
    case "instructor_rating":
      return typeof course.primary_instructor_rmp === "number"
        ? course.primary_instructor_rmp
        : null;
    case "level":
      return parseCourseNumberForSort(course.number);
    case "credits":
      return typeof course.credit_hours === "number"
        ? course.credit_hours
        : null;
    case "relevance":
      return null;
  }
}
