import type { D1Database } from "@cloudflare/workers-types";
import { sanitizeFtsQuery } from "./search-text.js";
import { resolveQuery } from "./query-resolver.js";
import {
  compileDecisionSearchExpansions,
  compileDecisionSearchRescue,
} from "./decision-plan.js";
import type {
  SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import { searchPlanFiltersFromRequestFilters } from "./search-request.js";
import { withRequestFilterHints } from "./search-plan-hints.js";
import { compileQueryLanguageClause } from "./search-plan-query-language.js";
import {
  buildFallbackPlans,
  compileIntroductoryGatewayIntent,
  compileSortIntent,
  compileTopicExpansion,
  removeSortScaffolding,
} from "./search-plan-intent-passes.js";
import { withSearchPlanUpdates } from "./search-plan-model.js";
import {
  compilerEvent,
  type SearchCompilerEvent,
  type SearchCompilerEventStage,
  type SearchPlanningInput,
} from "./search-planning-types.js";
import type { SearchPlan } from "./search-planner-types.js";

export type PlanningArtifact =
  | "parsed_query"
  | "student_language_extraction"
  | "request_filter_hints"
  | "resolved_plan"
  | "query_language"
  | "request_filter_overrides"
  | "introductory_gateway"
  | "decision_rescue"
  | "sort_intent"
  | "topic_expansion"
  | "sanitized_plan"
  | "fallback_plans";

export type SearchPlanningContext = {
  db: D1Database;
  query: string;
  requestFilters?: SearchRequestFiltersDto;
  input: SearchPlanningInput;
  planningInput: SearchPlanningInput;
  plan?: SearchPlan;
  queryResidual: string;
  fallbackPlans: SearchPlan[];
  compilerEvents: SearchCompilerEvent[];
  artifacts: Set<PlanningArtifact>;
};

export type SearchPlanningPass = {
  id: string;
  stage: SearchCompilerEventStage;
  reads: readonly PlanningArtifact[];
  writes: readonly PlanningArtifact[];
  run: (context: SearchPlanningContext) => Promise<void> | void;
};

export function createPlanningContext(
  db: D1Database,
  query: string,
  input: SearchPlanningInput,
  requestFilters?: SearchRequestFiltersDto,
): SearchPlanningContext {
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
  const planningInput = withRequestFilterHints(input, requestFilters);

  if (requestFilters) {
    compilerEvents.push(
      compilerEvent("extract", "request_filter_hints", "Merged structured request filters as explicit hints", {
        filters: Object.keys(requestFilters).filter(
          (key) => requestFilters[key as keyof SearchRequestFiltersDto] !== undefined,
        ),
      }),
    );
  }

  return {
    db,
    query,
    requestFilters,
    input,
    planningInput,
    queryResidual: "",
    fallbackPlans: [],
    compilerEvents,
    artifacts: new Set([
      "parsed_query",
      "student_language_extraction",
      "request_filter_hints",
    ]),
  };
}

export async function runPlanningPasses(
  context: SearchPlanningContext,
  passes: readonly SearchPlanningPass[] = SEARCH_PLANNING_PASSES,
): Promise<SearchPlanningContext> {
  for (const pass of passes) {
    assertReadableArtifacts(context, pass);
    await pass.run(context);
    assertWritableArtifacts(context, pass);
    for (const artifact of pass.writes) {
      context.artifacts.add(artifact);
    }
  }
  return context;
}

export const SEARCH_PLANNING_PASSES: readonly SearchPlanningPass[] = [
  {
    id: "resolve_validated_hints",
    stage: "resolve",
    reads: ["student_language_extraction", "request_filter_hints"],
    writes: ["resolved_plan"],
    async run(context) {
      let plan = await resolveQuery(context.db, context.planningInput.extracted);
      context.compilerEvents.push(
        compilerEvent("resolve", "validated_hints", "Resolved extracted hints into structured filters", {
          filters: Object.keys(plan.filters),
          keywordQuery: plan.keywordQuery,
          semanticQuery: plan.semanticQuery,
        }),
      );
      plan = withSearchPlanUpdates(plan, draft => {
        draft.rawQuery = context.query;
      });
      context.plan = plan;
      context.queryResidual = plan.semanticQuery;
    },
  },
  {
    id: "apply_query_language_clause",
    stage: "compile",
    reads: ["parsed_query", "resolved_plan"],
    writes: ["query_language", "resolved_plan"],
    run(context) {
      const clause = context.planningInput.parsed.clauses[0];
      const result = compileQueryLanguageClause(clause, requirePlan(context));
      context.plan = result.plan;
      context.compilerEvents.push(...result.events);
    },
  },
  {
    id: "apply_request_filter_overrides",
    stage: "compile",
    reads: ["request_filter_hints", "resolved_plan"],
    writes: ["request_filter_overrides", "resolved_plan"],
    run(context) {
      if (!context.requestFilters) return;
      const filterOverrides = searchPlanFiltersFromRequestFilters(context.requestFilters);
      context.plan = withSearchPlanUpdates(requirePlan(context), draft => {
        Object.assign(draft.filters, filterOverrides);
      });
      context.compilerEvents.push(
        compilerEvent("compile", "request_filter_overrides", "Applied canonical structured request filters", {
          filters: Object.keys(filterOverrides ?? {}),
        }),
      );
    },
  },
  {
    id: "compile_introductory_gateway",
    stage: "compile",
    reads: ["resolved_plan"],
    writes: ["introductory_gateway", "resolved_plan"],
    run(context) {
      const result = compileIntroductoryGatewayIntent(requirePlan(context));
      context.plan = result.plan;
      if (!result.applied) return;
      context.queryResidual = result.plan.semanticQuery;
      context.compilerEvents.push(
        compilerEvent("compile", "introductory_gateway", "Compiled introductory subject search as gateway intent"),
      );
    },
  },
  {
    id: "compile_decision_rescue",
    stage: "rescue",
    reads: ["resolved_plan"],
    writes: ["decision_rescue", "resolved_plan"],
    run(context) {
      const result = compileDecisionSearchRescue(
        requirePlan(context),
        context.query,
        context.queryResidual,
      );
      context.plan = result.plan;
      context.queryResidual = result.queryResidual;
      if (!context.plan.rescue) return;
      context.compilerEvents.push(
        compilerEvent("rescue", "decision_search_rescue", "Compiled decision-oriented query rescue metadata", {
          queryTypes: context.plan.rescue.queryTypes,
          negativeTerms: context.plan.rescue.negativeTerms,
        }),
      );
    },
  },
  {
    id: "compile_sort_intent",
    stage: "compile",
    reads: ["resolved_plan", "decision_rescue"],
    writes: ["sort_intent", "resolved_plan"],
    run(context) {
      const result = compileSortIntent(requirePlan(context), context.query);
      context.plan = result.plan;
      if (!result.applied) return;
      context.queryResidual = removeSortScaffolding(context.queryResidual);
      context.compilerEvents.push(
        compilerEvent("compile", "sort_intent", "Compiled sort language into request sort intent", {
          sort: result.inferredSort,
        }),
      );
    },
  },
  {
    id: "compile_topic_expansion",
    stage: "compile",
    reads: ["resolved_plan", "decision_rescue"],
    writes: ["topic_expansion", "resolved_plan"],
    run(context) {
      const topicExpansionResult = compileTopicExpansion(requirePlan(context));
      const topicExpansions = topicExpansionResult.expansions;
      context.plan = compileDecisionSearchExpansions(
        topicExpansionResult.plan,
        topicExpansions,
      );
      if (topicExpansions.length === 0) return;
      context.compilerEvents.push(
        compilerEvent("compile", "topic_expansion", "Expanded student topic language for retrieval recall", {
          expansions: topicExpansions,
        }),
      );
    },
  },
  {
    id: "finalize_sanitized_plan",
    stage: "finalize",
    reads: ["resolved_plan", "topic_expansion"],
    writes: ["sanitized_plan", "fallback_plans"],
    run(context) {
      context.plan = withSearchPlanUpdates(requirePlan(context), draft => {
        draft.keywordQuery = sanitizeFtsQuery(draft.keywordQuery);
        draft.semanticQuery = sanitizeFtsQuery(draft.semanticQuery);
      });
      context.fallbackPlans = buildFallbackPlans(context.plan, context.queryResidual);
      if (context.fallbackPlans.length > 0) {
        context.compilerEvents.push(
          compilerEvent("finalize", "fallback_plans", "Compiled low-result fallback retrieval plans", {
            fallbackPlans: context.fallbackPlans.length,
          }),
        );
      }
      context.compilerEvents.push(
        compilerEvent("finalize", "sanitize_and_freeze", "Sanitized retrieval query text and froze compiled plan"),
      );
    },
  },
];

function requirePlan(context: SearchPlanningContext): SearchPlan {
  if (!context.plan) {
    throw new Error("Search planning pass expected a resolved plan");
  }
  return context.plan;
}

function assertReadableArtifacts(
  context: SearchPlanningContext,
  pass: SearchPlanningPass,
): void {
  const missing = pass.reads.filter((artifact) => !context.artifacts.has(artifact));
  if (missing.length === 0) return;
  throw new Error(
    `Search planning pass "${pass.id}" reads missing artifacts: ${missing.join(", ")}`,
  );
}

function assertWritableArtifacts(
  context: SearchPlanningContext,
  pass: SearchPlanningPass,
): void {
  const missing = pass.writes.filter((artifact) => !artifactIsPresent(context, artifact));
  if (missing.length === 0) return;
  throw new Error(
    `Search planning pass "${pass.id}" declared missing writes: ${missing.join(", ")}`,
  );
}

function artifactIsPresent(
  context: SearchPlanningContext,
  artifact: PlanningArtifact,
): boolean {
  switch (artifact) {
    case "parsed_query":
      return Array.isArray(context.input.parsed.clauses);
    case "student_language_extraction":
      return Array.isArray(context.input.extraction.hints);
    case "request_filter_hints":
      return Array.isArray(context.planningInput.extraction.hints);
    case "resolved_plan":
    case "query_language":
    case "request_filter_overrides":
    case "introductory_gateway":
    case "decision_rescue":
    case "sort_intent":
    case "topic_expansion":
    case "sanitized_plan":
      return context.plan !== undefined;
    case "fallback_plans":
      return Array.isArray(context.fallbackPlans);
  }
}
