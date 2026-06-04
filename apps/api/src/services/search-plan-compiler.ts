import type { D1Database } from "@cloudflare/workers-types";
import { resolveQuery } from "./query-resolver.js";
import { sanitizeFtsQuery } from "./search-text.js";
import {
  applyDecisionSearchRescue,
  syncDecisionSearchExpansions,
} from "./decision-plan.js";
import {
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import {
  deepFreeze,
  searchPlanFiltersFromRequestFilters,
} from "./search-request.js";
import {
  extractSearchPlanningInput,
  withManualRequestFilterHints,
} from "./search-plan-hints.js";
import { applyQueryLanguageClause } from "./search-plan-query-language.js";
import {
  applyIntroductoryGatewayIntent,
  applySortIntent,
  applyTopicExpansion,
  buildFallbackPlans,
  removeSortScaffolding,
} from "./search-plan-intent-passes.js";
import {
  compilerEvent,
  type SearchCompilerEvent,
  type SearchPlanningInput,
  type SearchPlanningResult,
} from "./search-planning-types.js";

export { extractSearchPlanningInput } from "./search-plan-hints.js";
export type {
  SearchCompilerEvent,
  SearchCompilerEventStage,
  SearchPlanningInput,
  SearchPlanningResult,
} from "./search-planning-types.js";

export async function createSearchPlan(
  db: D1Database,
  query: string,
  input: SearchPlanningInput = extractSearchPlanningInput(query),
  requestFilters?: SearchRequestFiltersDto,
): Promise<SearchPlanningResult> {
  const compilerEvents: SearchCompilerEvent[] = [
    compilerEvent("parse", "query_language", "Parsed query language clauses", {
      clauses: input.parsed.clauses.length,
      filters: input.parsed.clauses.flatMap((clause) => clause.filters).length,
    }),
    compilerEvent("extract", "student_language", "Extracted student-language hints", {
      hints: input.extraction.hints.map((hint) => hint.type),
      residual: input.extraction.residual,
    }),
  ];
  const planningInput = withManualRequestFilterHints(input, requestFilters);
  if (requestFilters) {
    compilerEvents.push(
      compilerEvent("extract", "manual_filter_hints", "Merged structured request filters as manual hints", {
        filters: Object.keys(requestFilters).filter((key) => requestFilters[key as keyof SearchRequestFiltersDto] !== undefined),
      }),
    );
  }

  const plan = await resolveQuery(db, planningInput.extracted);
  compilerEvents.push(
    compilerEvent("resolve", "validated_hints", "Resolved extracted hints into structured filters", {
      filters: Object.keys(plan.filters),
      keywordQuery: plan.keywordQuery,
      semanticQuery: plan.semanticQuery,
    }),
  );
  plan.rawQuery = query;
  let queryResidual = plan.semanticQuery;

  const clause = planningInput.parsed.clauses[0];
  compilerEvents.push(...applyQueryLanguageClause(clause, plan));

  if (requestFilters) {
    const filterOverrides = searchPlanFiltersFromRequestFilters(requestFilters);
    Object.assign(plan.filters, filterOverrides);
    compilerEvents.push(
      compilerEvent("compile", "request_filter_overrides", "Applied canonical structured request filters", {
        filters: Object.keys(filterOverrides ?? {}),
      }),
    );
  }

  if (applyIntroductoryGatewayIntent(plan)) {
    queryResidual = plan.semanticQuery;
    compilerEvents.push(
      compilerEvent("compile", "introductory_gateway", "Compiled introductory subject search as gateway intent"),
    );
  }

  const rescueResult = applyDecisionSearchRescue(plan, query, queryResidual);
  queryResidual = rescueResult.queryResidual;
  if (plan.rescue) {
    compilerEvents.push(
      compilerEvent("rescue", "decision_search_rescue", "Compiled decision-oriented query rescue metadata", {
        queryTypes: plan.rescue.queryTypes,
        negativeTerms: plan.rescue.negativeTerms,
      }),
    );
  }

  if (applySortIntent(plan, query)) {
    queryResidual = removeSortScaffolding(queryResidual);
    compilerEvents.push(
      compilerEvent("compile", "sort_intent", "Compiled sort language into request sort intent", {
        sort: plan.softPreferences?.inferredSort,
      }),
    );
  }

  const topicExpansions = applyTopicExpansion(plan);
  syncDecisionSearchExpansions(plan, topicExpansions);
  if (topicExpansions.length > 0) {
    compilerEvents.push(
      compilerEvent("compile", "topic_expansion", "Expanded student topic language for retrieval recall", {
        expansions: topicExpansions,
      }),
    );
  }

  plan.keywordQuery = sanitizeFtsQuery(plan.keywordQuery);
  plan.semanticQuery = sanitizeFtsQuery(plan.semanticQuery);
  const fallbackPlans = buildFallbackPlans(plan, queryResidual);
  if (fallbackPlans.length > 0) {
    compilerEvents.push(
      compilerEvent("finalize", "fallback_plans", "Compiled low-result fallback retrieval plans", {
        fallbackPlans: fallbackPlans.length,
      }),
    );
  }
  compilerEvents.push(
    compilerEvent("finalize", "sanitize_and_freeze", "Sanitized retrieval query text and froze compiled plan"),
  );

  return deepFreeze({
    extraction: planningInput.extraction,
    queryResidual,
    plan,
    fallbackPlans,
    compilerEvents,
  });
}
