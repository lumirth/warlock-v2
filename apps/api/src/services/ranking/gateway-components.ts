import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { catalogLevel, normalizedTitle } from "./ranking-text.js";
import { RANKING_POLICY } from "./ranking-policy.js";
import { scoreComponent } from "./score-utils.js";

export function introductoryGatewayComponents(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent[] {
  if (plan.introductoryGateway !== true) {
    return [];
  }

  const components: RankingScoreComponent[] = [];
  const level = catalogLevel(result.course.number);
  const levelPolicy = RANKING_POLICY.components.introductoryGateway.level;
  if (level === 100) {
    components.push(scoreComponent(
      "level_accessibility",
      levelPolicy.level100,
      "100-level course fits introductory gateway intent.",
      ["100 level"],
    ));
  } else if (level === 200) {
    components.push(scoreComponent(
      "level_accessibility",
      levelPolicy.level200,
      "200-level course partially fits introductory gateway intent.",
      ["200 level"],
    ));
  } else if (level !== null && level >= 300) {
    components.push(scoreComponent(
      "level_accessibility",
      levelPolicy.level300Plus,
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

function introductoryGatewayTitleAdjustment(
  title: string | null | undefined,
): number {
  const titleText = normalizedTitle(title);
  if (!titleText) return 0;
  const policy = RANKING_POLICY.components.introductoryGateway.titleLanguage;

  if (policy.introductory.phrases.some(phrase => titleText.includes(phrase))) {
    return policy.introductory.value;
  }

  if (policy.disqualifying.phrases.some(phrase => titleText.includes(phrase))) {
    return policy.disqualifying.value;
  }

  return 0;
}

function canonicalGatewayNumberAdjustment(course: Course): number {
  const numbers = gatewayNumbersForSubject(course.subject);
  if (!numbers) return 0;

  const index = numbers.indexOf(course.number);
  const score = RANKING_POLICY.components.introductoryGateway.canonicalNumberScore;
  return index === -1 ? 0 : score.base - (index * score.rankStep);
}

function gatewayNumbersForSubject(subject: string): readonly string[] | undefined {
  const numbers = RANKING_POLICY.components.introductoryGateway.canonicalNumbers;
  return numbers[subject.toUpperCase() as keyof typeof numbers];
}
