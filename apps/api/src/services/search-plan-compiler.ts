import type { D1Database } from "@cloudflare/workers-types";
import type { SearchRequestFiltersDto } from "@uiuc-course-search/query-types";
import { mergeSearchIntentExpansions, compileSearchIntent } from "./search-intent-compiler.js";
import { extract } from "./extractor.js";
import { parseQuery } from "./query-parser.js";
import { resolveQuery } from "./query-resolver.js";
import { resolveSearchRequestFilters } from "./search-request-filters.js";
import {
  compileIntroductoryGatewayIntent,
  compileSortIntent,
  compileTopicExpansion,
  removeSortScaffolding,
} from "./search-plan-intents.js";
import { withSearchPlanUpdates } from "./search-plan-model.js";
import { compileQueryLanguage } from "./search-plan-query-language.js";
import {
  compilerEvent,
  type SearchPlanningResult,
} from "./search-planning-types.js";
import { sanitizeFtsQuery } from "./search-text.js";

export type {
  SearchCompilerEvent,
  SearchPlanningResult,
} from "./search-planning-types.js";

export async function createSearchPlan(
  db: D1Database,
  query: string,
  requestFilters?: SearchRequestFiltersDto,
): Promise<SearchPlanningResult> {
  const parsed = parseQuery(query);
  const extraction = extract(parsed.residual);
  const compilerEvents = [
    compilerEvent("parse", "query_language", "Parsed query-language filters", {
      filters: parsed.filters.length,
    }),
    compilerEvent("extract", "student_language", "Extracted student-language hints", {
      hints: extraction.hints.map((hint) => hint.type),
      residual: extraction.residual,
    }),
  ];
  let plan = await resolveQuery(db, query, extraction);
  compilerEvents.push(
    compilerEvent("resolve", "validated_hints", "Resolved extracted hints into structured filters", {
      filters: Object.keys(plan.filters),
      keywordQuery: plan.keywordQuery,
      semanticQuery: plan.semanticQuery,
    }),
  );
  let queryResidual = plan.semanticQuery;

  const queryLanguage = compileQueryLanguage(parsed, plan);
  plan = queryLanguage.plan;
  compilerEvents.push(...queryLanguage.events);

  if (requestFilters) {
    const overrides = await resolveSearchRequestFilters(db, requestFilters);
    plan = withSearchPlanUpdates(plan, draft => {
      Object.assign(draft.filters, overrides);
    });
    compilerEvents.push(
      compilerEvent("compile", "request_filter_overrides", "Applied canonical structured request filters", {
        filters: Object.keys(overrides ?? {}),
      }),
    );
  }

  const introductory = compileIntroductoryGatewayIntent(plan);
  plan = introductory.plan;
  if (introductory.applied) {
    queryResidual = plan.semanticQuery;
    compilerEvents.push(
      compilerEvent("compile", "introductory_gateway", "Compiled introductory subject search as gateway intent"),
    );
  }

  const interpreted = compileSearchIntent(plan, query, queryResidual);
  plan = interpreted.plan;
  queryResidual = interpreted.queryResidual;
  if (plan.intent) {
    compilerEvents.push(
      compilerEvent("interpret", "student_intent", "Compiled student-language intent", {
        queryTypes: plan.intent.queryTypes,
        negativeTerms: plan.intent.negativeTerms,
      }),
    );
  }

  const sortIntent = compileSortIntent(plan, query);
  plan = sortIntent.plan;
  if (sortIntent.applied) {
    queryResidual = removeSortScaffolding(queryResidual);
    compilerEvents.push(
      compilerEvent("compile", "sort_intent", "Compiled sort language into request sort intent", {
        sort: sortIntent.inferredSort,
      }),
    );
  }

  const topicExpansion = compileTopicExpansion(plan);
  plan = mergeSearchIntentExpansions(topicExpansion.plan, topicExpansion.expansions);
  if (topicExpansion.expansions.length > 0) {
    compilerEvents.push(
      compilerEvent("compile", "topic_expansion", "Expanded student topic language for retrieval recall", {
        expansions: topicExpansion.expansions,
      }),
    );
  }

  plan = withSearchPlanUpdates(plan, draft => {
    draft.keywordQuery = sanitizeFtsQuery(draft.keywordQuery);
    draft.semanticQuery = sanitizeFtsQuery(draft.semanticQuery);
  });
  compilerEvents.push(
    compilerEvent("finalize", "sanitize", "Sanitized retrieval query text"),
  );

  return {
    extraction,
    queryResidual,
    plan,
    compilerEvents,
  };
}
