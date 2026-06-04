import {
  COURSE_USEFULNESS_POLICY,
  SEARCH_SORT_FIELDS,
  getQualityTierLabel,
  getQualityTierRank,
  getWorkloadTierLabel,
  getWorkloadTierRank,
  hasRequirementFilter,
  requirementFilterCodes,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { SearchFilters, SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import type { Course } from "../db/types.js";
import type { RankingScoreComponent, SearchResult } from "./search-types.js";

const INTRODUCTORY_GATEWAY_NUMBERS: Record<string, string[]> = {
  CS: ["124", "101", "105", "128"],
  ECE: ["110", "120"],
  ECON: ["102", "103"],
  MATH: ["220", "221", "234"],
  PSYC: ["100"],
  SPAN: ["101", "102", "122"],
  STAT: ["100", "107", "200"],
};

export interface RankingTermInfo {
  term_id: string;
  year: number;
  term: string;
  status: string;
}

type NegativePreferenceContext = {
  negativeTerms: Set<string>;
  excludedSubjects: Set<string>;
  softPreferences: SearchPlan["softPreferences"];
};
type EvidenceLabel = string | ((course: Course) => string);
type NegativePreferencePenaltyRule = {
  value: number;
  evidence: EvidenceLabel;
  matches: (course: Course) => boolean;
};
type NegativePreferenceRule = {
  applies: (context: NegativePreferenceContext) => boolean;
  penalties: NegativePreferencePenaltyRule[];
};

const NEGATIVE_PREFERENCE_RULES: NegativePreferenceRule[] = [
  {
    applies: ({ negativeTerms, excludedSubjects, softPreferences }) => (
      negativeTerms.has("math_heavy")
      || Boolean(softPreferences?.lowMath)
      || excludedSubjects.has("MATH")
      || excludedSubjects.has("STAT")
    ),
    penalties: [
      {
        value: -0.7,
        evidence: "math-heavy language",
        matches: course => /\b(qr|quantitative|calculus|statistics|statistical|programming|formal logic)\b/.test(
          courseText(course, ["subject", "title", "description", "gened"]),
        ),
      },
      {
        value: -0.4,
        evidence: course => `subject ${course.subject}`,
        matches: course => ["MATH", "STAT"].includes(course.subject.toUpperCase()),
      },
    ],
  },
  {
    applies: ({ negativeTerms, softPreferences }) => (
      negativeTerms.has("writing_heavy")
      || negativeTerms.has("writing")
      || negativeTerms.has("essay")
      || negativeTerms.has("essays")
      || Boolean(softPreferences?.lowWriting)
    ),
    penalties: [{
      value: -0.55,
      evidence: "writing-heavy language",
      matches: course => /\b(advanced composition|writing intensive|essay|papers?)\b/.test(
        courseText(course, ["title", "description", "gened"]),
      ),
    }],
  },
  {
    applies: ({ negativeTerms, excludedSubjects }) => (
      negativeTerms.has("biology_heavy")
      || excludedSubjects.has("MCB")
      || excludedSubjects.has("IB")
    ),
    penalties: [
      {
        value: -0.45,
        evidence: "biology-heavy language",
        matches: course => /\b(bio|biology|biological|molecular|cellular|anatomy|physiology)\b/.test(
          courseText(course, ["subject", "title", "description"]),
        ),
      },
      {
        value: -0.35,
        evidence: course => `subject ${course.subject}`,
        matches: course => ["IB", "MCB"].includes(course.subject.toUpperCase()),
      },
    ],
  },
  {
    applies: ({ negativeTerms }) => negativeTerms.has("lab") || negativeTerms.has("labs"),
    penalties: [{
      value: -0.45,
      evidence: "lab language",
      matches: course => /\b(lab|laboratory)\b/.test(
        courseText(course, ["title", "description", "course_info"]),
      ),
    }],
  },
  {
    applies: ({ negativeTerms }) => negativeTerms.has("coding") || negativeTerms.has("programming"),
    penalties: [{
      value: -0.55,
      evidence: "coding/programming language",
      matches: course => (
        /\b(coding|programming|programs?|software|computer science)\b/.test(
          courseText(course, ["subject", "title", "description"]),
        )
        || course.subject.toUpperCase() === "CS"
      ),
    }],
  },
];

export function applyRankingPolicy(
  results: SearchResult[],
  plan: SearchPlan,
  options: { query?: string } = {},
): SearchResult[] {
  const query = options.query ?? plan.keywordQuery ?? "";

  return results
    .map((result) => {
      const components = rankingComponentsForResult(result, plan, query);
      return {
        ...result,
        score: componentTotal(components),
        scoreComponents: components,
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function applyTermRankingPolicy(
  results: SearchResult[],
  context: {
    termStates: RankingTermInfo[];
    limit: number;
  },
): SearchResult[] {
  const priorityByTermId = buildTermPriorityMap(context.termStates);
  const currentTermIds = new Set(context.termStates.map(term => term.term_id));

  const enrichedResults = results.map((result) => {
    const termInfo: RankingTermInfo = {
      term_id: `${result.course.year}-${result.course.term}`,
      year: result.course.year,
      term: result.course.term,
      status: "historical",
    };
    const termPriority = getTermPriority(termInfo, priorityByTermId);
    const historical = !currentTermIds.has(termInfo.term_id);
    const termComponent = scoreComponent(
      "term_tie_breaker",
      0,
      historical
        ? `Historical ${result.course.term} ${result.course.year} result is ordered after current terms.`
        : `Current ${result.course.term} ${result.course.year} term priority ${termPriority}.`,
      [`term priority ${termPriority}`],
    );

    return {
      ...result,
      termPriority,
      historical,
      scoreComponents: appendScoreComponents(result.scoreComponents, [termComponent]),
    };
  });

  enrichedResults.sort(compareRankedSearchResults);

  return enrichedResults.slice(0, context.limit);
}

export function compareRankedSearchResults(
  left: SearchResult,
  right: SearchResult,
): number {
  if (left.termPriority !== right.termPriority) {
    return (left.termPriority ?? 100) - (right.termPriority ?? 100);
  }
  return right.score - left.score;
}

export function buildTermPriorityMap(termStates: RankingTermInfo[]): Map<string, number> {
  const sorted = [...termStates].sort((left, right) => {
    const statusDelta = termStatusRank(left.status) - termStatusRank(right.status);
    if (statusDelta !== 0) return statusDelta;
    if (left.year !== right.year) return right.year - left.year;
    const regularTermDelta = regularTermRank(left.term) - regularTermRank(right.term);
    if (regularTermDelta !== 0) return regularTermDelta;
    return termChronology(right.year, right.term) - termChronology(left.year, left.term);
  });

  return new Map(sorted.map((term, index) => [term.term_id, index]));
}

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
    case "workload":
      return getWorkloadTierRank(course.difficulty_score);
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

export function isSearchSort(value: unknown): value is SearchSort {
  if (!value || typeof value !== "object") return false;
  const candidate = value as SearchSort;
  return (
    SEARCH_SORT_FIELDS.includes(candidate.field) &&
    (candidate.direction === "asc" || candidate.direction === "desc")
  );
}

function rankingComponentsForResult(
  result: SearchResult,
  plan: SearchPlan,
  query: string,
): RankingScoreComponent[] {
  return [
    retrievalFusionComponent(result),
    titleMatchComponent(result.course, query),
    exactnessComponent(result),
    qualityTierComponent(result.course),
    requirementComponent(result.course, plan),
    laneMatchComponent(result, "structured_section", "availability_term", 0.35, "Section constraints matched structured offering data."),
    laneMatchComponent(result, "student_language_alias", "student_language", 0.25, "Student-language aliases matched this course."),
    laneMatchComponent(result, "workload_evidence", "workload_evidence", 0.45, "Workload evidence matched the subjective preference."),
    ...workloadPreferenceComponents(result, plan),
    eligibilityComponent(result.course, plan),
    negativePreferenceComponent(result.course, plan),
    nullDataPenaltyComponent(result, plan),
    ...introductoryGatewayComponents(result, plan),
  ].filter((component): component is RankingScoreComponent => Boolean(component));
}

function retrievalFusionComponent(result: SearchResult): RankingScoreComponent {
  const lanes = result.laneMatches?.length ? result.laneMatches.join(", ") : "retrieval";
  const laneEvidence = result.laneResults
    ?.map(row => `${row.lane} #${row.rank}: ${row.reason}`)
    .slice(0, 5);
  return scoreComponent(
    "retrieval_fusion",
    result.score,
    `Retrieval lane fusion from ${lanes}.`,
    laneEvidence,
  );
}

function titleMatchComponent(
  course: Course,
  query: string,
): RankingScoreComponent | null {
  const value = titleMatchScore(course.title, query);
  if (value === 0) return null;
  return scoreComponent(
    "title_match",
    value,
    value >= 2.5
      ? `Title exactly matches "${course.title}".`
      : `Title matches the query text.`,
    [course.title ?? ""].filter(Boolean),
  );
}

function exactnessComponent(result: SearchResult): RankingScoreComponent | null {
  if (!result.laneMatches?.includes("exact")) {
    return null;
  }

  const evidence = result.laneResults
    ?.filter(row => row.lane === "exact")
    .map(row => row.reason);
  return scoreComponent(
    "exactness",
    6,
    "Exact course or CRN lookup dominates broad relevance signals.",
    evidence,
  );
}

function qualityTierComponent(course: Course): RankingScoreComponent | null {
  const tierRank = getQualityTierRank(course.quality_score);
  if (tierRank === null) return null;
  const label = getQualityTierLabel(course.quality_score);
  return scoreComponent(
    "quality_tier",
    tierRank * COURSE_USEFULNESS_POLICY.FUSION.QUALITY_TIER_WEIGHT,
    `${label} quality tier contributes a small trust component.`,
    label ? [label] : undefined,
  );
}

function requirementComponent(
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

function laneMatchComponent(
  result: SearchResult,
  lane: NonNullable<SearchResult["laneMatches"]>[number],
  name: RankingScoreComponent["name"],
  value: number,
  reason: string,
): RankingScoreComponent | null {
  if (!result.laneMatches?.includes(lane)) return null;
  const evidence = result.laneResults
    ?.filter(row => row.lane === lane)
    .map(row => row.reason);
  return scoreComponent(name, value, reason, evidence);
}

function workloadPreferenceComponents(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent[] {
  if (!hasEasyOrAccessibleIntent(plan)) {
    return [];
  }

  const components: RankingScoreComponent[] = [];
  const { course } = result;
  const level = catalogLevel(course.number);
  const qualityTierRank = getQualityTierRank(course.quality_score);
  const qualityLabel = getQualityTierLabel(course.quality_score);
  const workloadTier = getWorkloadTierLabel(course.difficulty_score);

  if (
    qualityTierRank !== null &&
    qualityTierRank >= COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_QUALITY_TIER_RANK
  ) {
    components.push(scoreComponent(
      "workload_preference",
      0.25,
      `${qualityLabel} quality tier supports an easy or low-risk course choice.`,
      qualityLabel ? [qualityLabel] : undefined,
    ));
  }

  if (workloadTier === COURSE_USEFULNESS_POLICY.EASY_INTENT.PREFERRED_WORKLOAD_TIER) {
    components.push(scoreComponent(
      "workload_preference",
      0.3,
      "Displayed workload tier is Easy.",
      [workloadTier],
    ));
  }

  if (
    typeof course.avg_gpa === "number" &&
    course.avg_gpa >= COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_AVG_GPA
  ) {
    components.push(scoreComponent(
      "workload_preference",
      0.2,
      "Average GPA evidence supports a lower-risk workload interpretation.",
      [`Avg GPA ${course.avg_gpa.toFixed(2)}`],
    ));
  }

  const levelValue = easyIntentLevelValue(level);
  if (levelValue !== 0) {
    components.push(scoreComponent(
      "level_accessibility",
      levelValue,
      levelValue > 0
        ? `${level} level is more accessible for easy/non-major intent.`
        : `${level} level is a risk for easy/non-major intent.`,
      level !== null ? [`${level} level`] : undefined,
    ));
  }

  if (result.laneMatches?.includes("workload_evidence")) {
    components.push(scoreComponent(
      "workload_evidence",
      0.3,
      "Structured workload evidence reinforces the easy/low-workload preference.",
      result.supportedSubjectiveClaims,
    ));
  }

  return components;
}

function eligibilityComponent(
  course: Course,
  plan: SearchPlan,
): RankingScoreComponent | null {
  if (!plan.softPreferences?.noListedPrereq) {
    return null;
  }

  const text = `${course.title ?? ""} ${course.description ?? ""}`.toLowerCase();
  if (!/\b(prereq|prerequisite|consent|restricted|permission|credit or concurrent)\b/.test(text)) {
    return scoreComponent(
      "eligibility",
      0.35,
      "No listed prerequisite risk found in exposed course text.",
    );
  }

  return scoreComponent(
    "eligibility",
    -0.35,
    "Prerequisite, consent, or restriction language is visible in course text.",
  );
}

function negativePreferenceComponent(
  course: Course,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const context = negativePreferenceContext(plan);
  let penalty = 0;
  const evidence: string[] = [];

  for (const rule of NEGATIVE_PREFERENCE_RULES) {
    if (!rule.applies(context)) continue;
    for (const penaltyRule of rule.penalties) {
      if (!penaltyRule.matches(course)) continue;
      penalty += penaltyRule.value;
      evidence.push(evidenceLabel(penaltyRule.evidence, course));
    }
  }

  return penalty === 0
    ? null
    : scoreComponent(
      "negative_preference_penalty",
      penalty,
      "Course conflicts with an avoided topic or workload signal.",
      evidence,
    );
}

function negativePreferenceContext(plan: SearchPlan): NegativePreferenceContext {
  return {
    negativeTerms: new Set([
      ...(plan.rescue?.negativeTerms ?? []),
      ...(plan.filters.not?.keywords ?? []),
    ]),
    excludedSubjects: new Set(
      (plan.filters.not?.subjects ?? []).map(subject => subject.toUpperCase()),
    ),
    softPreferences: plan.softPreferences,
  };
}

function nullDataPenaltyComponent(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const needsEvidence = Boolean(
    plan.rescue?.queryTypes.includes("subjective_vibe")
    || plan.rescue?.queryTypes.includes("avoidance"),
  );
  if (!needsEvidence) return null;

  const hasStructuredSupport = result.laneMatches?.includes("workload_evidence")
    || Boolean(result.supportedSubjectiveClaims?.length)
    || typeof result.course.quality_score === "number"
    || typeof result.course.difficulty_score === "number"
    || typeof result.course.avg_gpa === "number";

  return hasStructuredSupport
    ? null
    : scoreComponent(
      "null_data_penalty",
      -0.35,
      "Subjective preference has no visible workload, quality, or GPA evidence for this course.",
    );
}

function introductoryGatewayComponents(
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

function titleMatchScore(
  title: string | null | undefined,
  query: string,
): number {
  const queryLower = normalizedPhrase(query);
  if (!queryLower || !title) return 0;

  const titleLower = normalizedPhrase(title);
  if (titleLower === queryLower) return 2.5;
  if (titleLower.includes(queryLower)) return 1.2;
  if (queryLower.includes(titleLower)) return 0.45;
  return 0;
}

function normalizedPhrase(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}

function normalizedTitle(title: string | null | undefined): string {
  return title?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

function courseText(
  course: Course,
  fields: Array<"subject" | "title" | "description" | "gened" | "course_info">,
): string {
  return fields
    .map(field => course[field] ?? "")
    .join(" ")
    .toLowerCase();
}

function evidenceLabel(label: EvidenceLabel, course: Course): string {
  return typeof label === "function" ? label(course) : label;
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

function hasEasyOrAccessibleIntent(plan: SearchPlan): boolean {
  const soft = plan.softPreferences ?? {};
  return Boolean(
    soft.lowWorkload
    || soft.lowWriting
    || soft.lowReading
    || soft.lowExams
    || soft.nonMajorFriendly
    || plan.filters.difficulty === "easy",
  );
}

function easyIntentLevelValue(level: number | null): number {
  if (level === 100) return 0.55;
  if (level === 200) return 0.35;
  if (level === 300) return 0.05;
  if (level === 400) return -0.35;
  if (level !== null && level >= 500) return -1.25;
  return 0;
}

function parseCourseNumberForSort(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return null;

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTermPriority(
  termInfo: RankingTermInfo,
  priorityByTermId: Map<string, number>,
): number {
  const knownPriority = priorityByTermId.get(termInfo.term_id);
  if (knownPriority !== undefined) return knownPriority;

  return 10_000 - termChronology(termInfo.year, termInfo.term);
}

function termChronology(year: number, term: string): number {
  const termRank: Record<string, number> = {
    winter: 1,
    spring: 2,
    summer: 3,
    fall: 4,
  };
  return year * 4 + (termRank[term.toLowerCase()] ?? 0);
}

function regularTermRank(term: string): number {
  return term === "fall" || term === "spring" ? 0 : 1;
}

function termStatusRank(status: string): number {
  if (status === "registrable") return 0;
  if (status === "active") return 1;
  return 2;
}

function componentTotal(components: RankingScoreComponent[]): number {
  return components.reduce((total, component) => total + component.value, 0);
}

function appendScoreComponents(
  existing: RankingScoreComponent[] | undefined,
  next: RankingScoreComponent[],
): RankingScoreComponent[] {
  return [...(existing ?? []), ...next];
}

function scoreComponent(
  name: RankingScoreComponent["name"],
  value: number,
  reason: string,
  evidence?: string[],
): RankingScoreComponent {
  return {
    name,
    value,
    reason,
    evidence: evidence?.filter(Boolean),
  };
}
