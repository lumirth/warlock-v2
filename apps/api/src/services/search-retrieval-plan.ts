import type { D1Database } from "@cloudflare/workers-types";
import { hasRequirementFilter } from "@uiuc-course-search/query-types";
import type { RetrievalLane, SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import { validateSubject } from "./query-resolver.js";
import type { SearchCandidateBudget } from "./search-budget.js";
import type { AppliedSearchControls } from "./search-controls.js";
import {
  buildAliasLaneQuery,
  workloadSignalTypes,
} from "./search-retrieval-lanes.js";
import { sanitizeFtsQuery } from "./search-text.js";

export type RetrievalLaneExecution = {
  lane: RetrievalLane;
  enabled: boolean;
  limit: number;
  reason: string;
};

export type RetrievalPlan = {
  inputPlan: SearchPlan;
  effectivePlan: SearchPlan;
  controls: AppliedSearchControls;
  budget: SearchCandidateBudget;
  isNavigational: boolean;
  hasKeywordQuery: boolean;
  hasSemanticQuery: boolean;
  lanes: RetrievalLaneExecution[];
  aliasQuery: string;
  workloadSignalTypes: string[];
};

export async function buildRetrievalPlan(
  db: D1Database,
  plan: SearchPlan,
  controls: AppliedSearchControls,
  budget: SearchCandidateBudget,
): Promise<RetrievalPlan> {
  const effectivePlan = await planWithResolvedSubject(db, plan);
  const hasKeywordQuery = effectivePlan.keywordQuery.trim().length > 0;
  const hasSemanticQuery = effectivePlan.semanticQuery.trim().length > 0;
  const isNavigational = Boolean(
    (effectivePlan.filters.subject && effectivePlan.filters.number) ||
      effectivePlan.filters.crn,
  );
  const aliasQuery = buildAliasLaneQuery(effectivePlan);
  const signalTypes = workloadSignalTypes(effectivePlan);

  return {
    inputPlan: plan,
    effectivePlan,
    controls,
    budget,
    isNavigational,
    hasKeywordQuery,
    hasSemanticQuery,
    lanes: [
      lane(
        isNavigational ? "exact" : "official_text",
        true,
        budget.laneCandidateLimit,
        isNavigational
          ? "course code or CRN lookup"
          : "official course/title/description text",
      ),
      lane(
        "section_text",
        hasKeywordQuery,
        budget.laneCandidateLimit,
        "section text search for query terms",
      ),
      lane(
        "requirement",
        hasRequirementLane(effectivePlan),
        budget.laneCandidateLimit,
        "concrete requirement filter",
      ),
      lane(
        "structured_section",
        hasStructuredSectionLane(effectivePlan),
        budget.laneCandidateLimit,
        "structured section filters or schedule preferences",
      ),
      lane(
        "student_language_alias",
        aliasQuery.length > 0,
        budget.laneCandidateLimit,
        "student-language alias query",
      ),
      lane(
        "topic_semantic",
        hasSemanticQuery && !isNavigational,
        budget.laneCandidateLimit,
        "semantic topic query and not an exact lookup",
      ),
      lane(
        "workload_evidence",
        signalTypes.length > 0,
        budget.laneCandidateLimit,
        "workload or subjective evidence request",
      ),
      lane("help_path", false, budget.laneCandidateLimit, "not implemented"),
    ],
    aliasQuery,
    workloadSignalTypes: signalTypes,
  };
}

export function laneEnabled(
  plan: RetrievalPlan,
  laneName: RetrievalLane,
): boolean {
  return plan.lanes.some((laneInfo) => laneInfo.lane === laneName && laneInfo.enabled);
}

function lane(
  laneName: RetrievalLane,
  enabled: boolean,
  limit: number,
  reason: string,
): RetrievalLaneExecution {
  return {
    lane: laneName,
    enabled,
    limit,
    reason,
  };
}

async function planWithResolvedSubject(
  db: D1Database,
  plan: SearchPlan,
): Promise<SearchPlan> {
  if (plan.filters.subject || plan.filters.number || !plan.keywordQuery.trim()) {
    return plan;
  }

  const cleanQuery = sanitizeFtsQuery(plan.keywordQuery);
  const potentialSubject = await validateSubject(db, cleanQuery);
  if (!potentialSubject) {
    return plan;
  }

  return {
    ...plan,
    filters: {
      ...plan.filters,
      subject: potentialSubject,
    },
  };
}

function hasRequirementLane(plan: SearchPlan): boolean {
  return hasRequirementFilter(plan.filters);
}

function hasStructuredSectionLane(plan: SearchPlan): boolean {
  return Boolean(
    plan.filters.online !== undefined ||
      plan.filters.days ||
      plan.filters.time ||
      plan.filters.status ||
      plan.filters.partOfTerm ||
      plan.softPreferences?.startAfterMinutes ||
      plan.softPreferences?.startBeforeMinutes ||
      plan.softPreferences?.compressedTerm ||
      plan.softPreferences?.asyncFriendly,
  );
}
