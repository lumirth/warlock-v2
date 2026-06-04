import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { catalogLevel, normalizedTitle } from "./ranking-text.js";
import { scoreComponent } from "./score-utils.js";

const INTRODUCTORY_GATEWAY_NUMBERS: Record<string, string[]> = {
  CS: ["124", "101", "105", "128"],
  ECE: ["110", "120"],
  ECON: ["102", "103"],
  MATH: ["220", "221", "234"],
  PSYC: ["100"],
  SPAN: ["101", "102", "122"],
  STAT: ["100", "107", "200"],
};

export function introductoryGatewayComponents(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent[] {
  if (!hasIntroductoryGatewayIntent(plan)) {
    return [];
  }

  const components: RankingScoreComponent[] = [];
  const level = catalogLevel(result.course.number);
  if (level === 100) {
    components.push(scoreComponent(
      "level_accessibility",
      1,
      "100-level course fits introductory gateway intent.",
      ["100 level"],
    ));
  } else if (level === 200) {
    components.push(scoreComponent(
      "level_accessibility",
      0.15,
      "200-level course partially fits introductory gateway intent.",
      ["200 level"],
    ));
  } else if (level !== null && level >= 300) {
    components.push(scoreComponent(
      "level_accessibility",
      -0.25,
      `${level} level is less likely to be an introductory gateway course.`,
      [`${level} level`],
    ));
  }

  const canonicalAdjustment = canonicalGatewayNumberAdjustment(result.course);
  if (canonicalAdjustment !== 0) {
    components.push(scoreComponent(
      "introductory_gateway",
      canonicalAdjustment,
      "Course number is a canonical gateway for this subject.",
      [`${result.course.subject} ${result.course.number}`],
    ));
  }

  const titleAdjustment = introductoryGatewayTitleAdjustment(result.course.title);
  if (titleAdjustment !== 0) {
    components.push(scoreComponent(
      "introductory_gateway",
      titleAdjustment,
      titleAdjustment > 0
        ? "Title language looks introductory."
        : "Title language looks like seminar, topics, or independent study.",
      result.course.title ? [result.course.title] : undefined,
    ));
  }

  return components;
}

function hasIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  return plan.intents?.includes("introductory_gateway")
    || plan.softPreferences?.introductoryIntent === "gateway";
}

function introductoryGatewayTitleAdjustment(
  title: string | null | undefined,
): number {
  const titleText = normalizedTitle(title);
  if (!titleText) return 0;

  if (
    titleText.startsWith("introduction to ")
    || titleText.startsWith("intro to ")
    || titleText.startsWith("introductory ")
    || titleText.includes(" introduction to ")
    || titleText.includes(" fundamentals of ")
  ) {
    return 0.75;
  }

  if (
    titleText.includes("undergraduate open seminar")
    || titleText.includes("special topics")
    || titleText.includes("independent study")
  ) {
    return -0.75;
  }

  return 0;
}

function canonicalGatewayNumberAdjustment(course: Course): number {
  const numbers = INTRODUCTORY_GATEWAY_NUMBERS[course.subject.toUpperCase()];
  if (!numbers) return 0;

  const index = numbers.indexOf(course.number);
  return index === -1 ? 0 : 2.0 - (index * 0.1);
}
