import { hasRequirementFilter } from "@uiuc-course-search/query-types";
import type { RetrievalLane, SearchPlan } from "./search-planner-types.js";
import type { SearchCandidateBudget } from "./search-budget.js";
import type { AppliedSearchControls } from "./search-controls.js";
import {
  buildAliasLaneQuery,
  workloadSignalTypes,
} from "./search-retrieval-plan-queries.js";

export type RetrievalLaneExecution = {
  lane: RetrievalLane;
  enabled: boolean;
  limit: number;
  reason: string;
};

export type RetrievalPlan = {
  plan: SearchPlan;
  controls: AppliedSearchControls;
  budget: SearchCandidateBudget;
  isNavigational: boolean;
  hasKeywordQuery: boolean;
  hasSemanticQuery: boolean;
  lanes: RetrievalLaneExecution[];
  aliasQuery: string;
  workloadSignalTypes: string[];
};

export function buildRetrievalPlan(
  plan: SearchPlan,
  controls: AppliedSearchControls,
  budget: SearchCandidateBudget,
): RetrievalPlan {
  const hasKeywordQuery = plan.keywordQuery.trim().length > 0;
  const hasSemanticQuery = plan.semanticQuery.trim().length > 0;
  const isNavigational = Boolean(
    (plan.filters.subject && plan.filters.number) ||
      plan.filters.crn,
  );
  const aliasQuery = buildAliasLaneQuery(plan);
  const signalTypes = workloadSignalTypes(plan);

  return {
    plan,
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
        hasRequirementLane(plan),
        budget.laneCandidateLimit,
        "concrete requirement filter",
      ),
      lane(
        "structured_section",
        hasStructuredSectionLane(plan),
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
      lane(
        "help_path",
        false,
        budget.laneCandidateLimit,
        "planned FAQ/degree-audit sidecar; no executable help corpus configured",
      ),
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

export function enabledRetrievalLanes(plan: RetrievalPlan): RetrievalLaneExecution[] {
  return plan.lanes.filter(laneInfo => laneInfo.enabled);
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
