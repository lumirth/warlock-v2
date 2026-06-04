import {
  hasRequirementFilter,
  requirementFilterCodes,
} from "@uiuc-course-search/query-types";
import type { Course } from "../../db/types.js";
import type { SearchFilters, SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent } from "../search-types.js";
import { scoreComponent } from "./score-utils.js";

export function requirementComponent(
  course: Course,
  plan: SearchPlan,
): RankingScoreComponent | null {
  if (matchesRequestedRequirement(course, plan.filters)) {
    return scoreComponent(
      "requirement_match",
      0.9,
      "Course satisfies the requested requirement filter.",
      [course.gened ?? ""].filter(Boolean),
    );
  }

  if (!hasRequirementIntent(plan)) {
    return null;
  }

  if (course.gened) {
    return scoreComponent(
      "requirement_match",
      0.25,
      "Course has requirement credit, but not the exact requested bucket.",
      [course.gened],
    );
  }

  return scoreComponent(
    "requirement_match",
    -0.25,
    "Requirement intent was detected, but this course has no visible requirement mapping.",
  );
}

function hasRequirementIntent(plan: SearchPlan): boolean {
  return Boolean(
    hasRequirementFilter(plan.filters)
    || plan.rescue?.queryTypes.includes("requirement")
    || plan.rescue?.queryTypes.includes("degree_progress"),
  );
}

function matchesRequestedRequirement(
  course: Course,
  filters: SearchFilters,
): boolean {
  const requested = requirementFilterCodes(filters);

  if (requested.length === 0) {
    return false;
  }

  const courseGened = (course.gened ?? "").toUpperCase();
  return requested.some(value => courseGened.includes(value.toUpperCase()));
}
