import {
  ANY_GENED_DISPLAY_LABEL,
  formatGenEdDisplayLabel,
  isGenericAnyRequirementFilter,
  type SearchCourseResultDto,
} from "@uiuc-course-search/query-types";
import { toCourseDto } from "../dto/course.js";
import type { Hint, SearchPlan } from "./search-planner-types.js";
import type { SearchResult } from "./search-types.js";

export function presentSearchCourseResult(
  result: SearchResult,
  context?: { plan: SearchPlan; hints?: Hint[] },
): SearchCourseResultDto {
  return {
    course: toCourseDto(result.course, {
      requirements: result.requirements,
      registrationSummary: result.registrationSummary,
    }),
    ...(context ? { matchEvidence: evidence(result, context) } : {}),
    warnings: result.historical ? [{ kind: "historical", message: "Historical term result" }] : [],
  };
}

function evidence(result: SearchResult, context: { plan: SearchPlan; hints?: Hint[] }): string[] {
  const values: string[] = [];
  const add: AddEvidence = label => values.push(label);
  addIdentityEvidence(add, result, context);
  addConstraintEvidence(add, context.plan);
  addRankingEvidence(add, result, context.plan);
  return values;
}

type AddEvidence = (label: string) => void;

function addIdentityEvidence(
  add: AddEvidence,
  result: SearchResult,
  context: { plan: SearchPlan; hints?: Hint[] },
): void {
  const filters = context.plan.filters;
  addCourseIdentity(add, filters);
  if (filters.instructor_ids?.length || context.hints?.some(hint => hint.type === "instructor")) {
    add("Instructor match");
  }
  if (filters.instructorDifficulty) add(filters.instructorDifficulty === "lower" ? "Lower instructor-rated difficulty" : "Higher instructor-rated difficulty");
}

function addCourseIdentity(add: AddEvidence, filters: SearchPlan["filters"]): void {
  if (filters.subject && filters.number) add(`Course ${filters.subject} ${filters.number}`);
  else {
    if (filters.subject) add(`Subject ${filters.subject}`);
    if (filters.number) add(`Number ${filters.number}`);
  }
  if (filters.crn) add(`CRN ${filters.crn}`);
}

function addConstraintEvidence(add: AddEvidence, plan: SearchPlan): void {
  const filters = plan.filters;
  addRequirementEvidence(add, filters.requirement);
  const schedule = [filters.days, filters.time, filters.status, filters.partOfTerm].filter(Boolean).join(" · ");
  if (schedule) add(schedule);
  if (filters.online !== undefined) add(filters.online ? "Online delivery" : "In-person delivery");
  if (filters.term || filters.year) add([filters.term, filters.year].filter(Boolean).join(" "));
}

function addRequirementEvidence(
  add: AddEvidence,
  requirement: SearchPlan["filters"]["requirement"],
): void {
  if (!requirement) return;
  add(isGenericAnyRequirementFilter(requirement.codes)
    ? ANY_GENED_DISPLAY_LABEL
    : formatGenEdDisplayLabel(requirement.codes));
}

function addRankingEvidence(add: AddEvidence, result: SearchResult, plan: SearchPlan): void {
  const query = plan.keywordQuery.trim().toLowerCase();
  if (query && result.course.title.toLowerCase().includes(query)) add(`Title match: ${result.course.title}`);
  if (plan.introductoryGateway && plan.softPreferences?.levelBoost) add("Introductory course");
  if (result.keywordRank !== undefined) add(result.keywordRank === 1 ? "Strong keyword match" : "Keyword match");
  if (result.semanticRank !== undefined) add(result.semanticRank === 1 ? "Strong topic match" : "Related topic match");
}
