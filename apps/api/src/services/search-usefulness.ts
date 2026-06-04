import {
  COURSE_USEFULNESS_POLICY,
  getQualityTierRank,
  getWorkloadTierLabel,
  hasRequirementFilter,
  requirementFilterCodes,
} from "@uiuc-course-search/query-types";
import type { SearchFilters, SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import type { Course } from '../db/types.js';
import type { SearchResult } from "./search-types.js";

const INTRODUCTORY_GATEWAY_NUMBERS: Record<string, string[]> = {
  CS: ["124", "101", "105", "128"],
  ECE: ["110", "120"],
  ECON: ["102", "103"],
  MATH: ["220", "221", "234"],
  PSYC: ["100"],
  SPAN: ["101", "102", "122"],
  STAT: ["100", "107", "200"],
};

export function applySearchIntentBoosts(
  results: SearchResult[],
  plan: SearchPlan,
): SearchResult[] {
  if (!hasIntroductoryGatewayIntent(plan)) {
    return results;
  }

  return results.map((result) => {
    const level = catalogLevel(result.course.number);
    let scoreAdjustment = 0;

    if (level === 100) {
      scoreAdjustment += 1.0;
    } else if (level === 200) {
      scoreAdjustment += 0.15;
    } else if (level !== null && level >= 300) {
      scoreAdjustment -= 0.25;
    }

    scoreAdjustment += canonicalGatewayNumberAdjustment(result.course);
    scoreAdjustment += introductoryGatewayTitleAdjustment(result.course.title);

    return {
      ...result,
      score: result.score + scoreAdjustment,
    };
  });
}

export function applyUsefulnessRerank(
  results: SearchResult[],
  plan: SearchPlan,
): SearchResult[] {
  const reranked = results.map(result => {
    let score = result.score;
    const course = result.course;

    if (result.laneMatches?.includes("exact")) {
      score += 2.5;
    }

    if (matchesRequestedRequirement(course, plan.filters)) {
      score += 0.9;
    } else if (hasRequirementIntent(plan) && course.gened) {
      score += 0.25;
    } else if (hasRequirementIntent(plan) && !course.gened) {
      score -= 0.25;
    }

    if (result.laneMatches?.includes("structured_section")) {
      score += 0.35;
    }

    if (result.laneMatches?.includes("student_language_alias")) {
      score += 0.25;
    }

    if (result.laneMatches?.includes("workload_evidence")) {
      score += 0.45;
    }

    score += workloadUsefulnessAdjustment(result, plan);
    score += eligibilityAdjustment(course, plan);
    score += negativePreferencePenalty(course, plan);
    score += unsupportedSubjectivePenalty(result, plan);

    return {
      ...result,
      score,
    };
  });

  return reranked.sort((a, b) => b.score - a.score);
}

function hasIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  return plan.intents?.includes("introductory_gateway")
    || plan.softPreferences?.introductoryIntent === "gateway";
}

function normalizedTitle(title: string | null | undefined): string {
  return title?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
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

function catalogLevel(number: string | null | undefined): number | null {
  const match = /^([1-5])/.exec(number ?? "");
  return match ? Number.parseInt(match[1], 10) * 100 : null;
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

function workloadUsefulnessAdjustment(
  result: SearchResult,
  plan: SearchPlan,
): number {
  const soft = plan.softPreferences ?? {};
  const hasEasyIntent = Boolean(
    soft.lowWorkload
    || soft.lowWriting
    || soft.lowReading
    || soft.lowExams
    || soft.nonMajorFriendly
    || plan.filters.difficulty === "easy",
  );

  if (!hasEasyIntent) {
    return 0;
  }

  let adjustment = 0;
  const { course } = result;
  const level = catalogLevel(course.number);
  const qualityTierRank = getQualityTierRank(course.quality_score);
  const workloadTier = getWorkloadTierLabel(course.difficulty_score);
  if (
    qualityTierRank !== null &&
    qualityTierRank >= COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_QUALITY_TIER_RANK
  ) {
    adjustment += 0.25;
  }
  if (workloadTier === COURSE_USEFULNESS_POLICY.EASY_INTENT.PREFERRED_WORKLOAD_TIER) {
    adjustment += 0.3;
  }
  if (
    typeof course.avg_gpa === "number" &&
    course.avg_gpa >= COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_AVG_GPA
  ) {
    adjustment += 0.2;
  }
  if (level === 100) adjustment += 0.55;
  if (level === 200) adjustment += 0.35;
  if (level === 300) adjustment += 0.05;
  if (level === 400) adjustment -= 0.35;
  if (level !== null && level >= 500) adjustment -= 1.25;
  if (result.laneMatches?.includes("workload_evidence")) adjustment += 0.3;

  return adjustment;
}

function eligibilityAdjustment(course: Course, plan: SearchPlan): number {
  if (!plan.softPreferences?.noListedPrereq) {
    return 0;
  }

  const text = `${course.title ?? ""} ${course.description ?? ""}`.toLowerCase();
  if (!/\b(prereq|prerequisite|consent|restricted|permission|credit or concurrent)\b/.test(text)) {
    return 0.35;
  }
  return -0.35;
}

function negativePreferencePenalty(course: Course, plan: SearchPlan): number {
  const negativeTerms = new Set([
    ...(plan.rescue?.negativeTerms ?? []),
    ...(plan.filters.not?.keywords ?? []),
  ]);
  const excludedSubjects = new Set(
    (plan.filters.not?.subjects ?? []).map(subject => subject.toUpperCase()),
  );
  let penalty = 0;

  if (
    negativeTerms.has("math_heavy")
    || plan.softPreferences?.lowMath
    || excludedSubjects.has("MATH")
    || excludedSubjects.has("STAT")
  ) {
    const text = `${course.subject} ${course.title ?? ""} ${course.description ?? ""} ${course.gened ?? ""}`.toLowerCase();
    if (/\b(qr|quantitative|calculus|statistics|statistical|programming|formal logic)\b/.test(text)) {
      penalty -= 0.7;
    }
    if (["MATH", "STAT"].includes(course.subject.toUpperCase())) {
      penalty -= 0.4;
    }
  }

  if (
    negativeTerms.has("writing_heavy")
    || negativeTerms.has("writing")
    || negativeTerms.has("essay")
    || negativeTerms.has("essays")
    || plan.softPreferences?.lowWriting
  ) {
    const text = `${course.title ?? ""} ${course.description ?? ""} ${course.gened ?? ""}`.toLowerCase();
    if (/\b(advanced composition|writing intensive|essay|papers?)\b/.test(text)) {
      penalty -= 0.55;
    }
  }

  if (
    negativeTerms.has("biology_heavy")
    || excludedSubjects.has("MCB")
    || excludedSubjects.has("IB")
  ) {
    const text = `${course.subject} ${course.title ?? ""} ${course.description ?? ""}`.toLowerCase();
    if (/\b(bio|biology|biological|molecular|cellular|anatomy|physiology)\b/.test(text)) {
      penalty -= 0.45;
    }
    if (["IB", "MCB"].includes(course.subject.toUpperCase())) {
      penalty -= 0.35;
    }
  }

  if (negativeTerms.has("lab") || negativeTerms.has("labs")) {
    const text = `${course.title ?? ""} ${course.description ?? ""} ${course.course_info ?? ""}`.toLowerCase();
    if (/\b(lab|laboratory)\b/.test(text)) {
      penalty -= 0.45;
    }
  }

  if (negativeTerms.has("coding") || negativeTerms.has("programming")) {
    const text = `${course.subject} ${course.title ?? ""} ${course.description ?? ""}`.toLowerCase();
    if (/\b(coding|programming|programs?|software|computer science)\b/.test(text) || course.subject === "CS") {
      penalty -= 0.55;
    }
  }

  return penalty;
}

function unsupportedSubjectivePenalty(
  result: SearchResult,
  plan: SearchPlan,
): number {
  const needsEvidence = Boolean(
    plan.rescue?.queryTypes.includes("subjective_vibe")
    || plan.rescue?.queryTypes.includes("avoidance"),
  );
  if (!needsEvidence) return 0;

  const hasStructuredSupport = result.laneMatches?.includes("workload_evidence")
    || Boolean(result.supportedSubjectiveClaims?.length)
    || typeof result.course.quality_score === "number"
    || typeof result.course.difficulty_score === "number"
    || typeof result.course.avg_gpa === "number";

  return hasStructuredSupport ? 0 : -0.35;
}
