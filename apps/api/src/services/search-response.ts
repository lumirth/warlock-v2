import type {
  SearchRecoveryGroup,
  SearchScope,
  SearchSort,
} from "@uiuc-course-search/query-types";
import type { Hint, SearchPlan } from "./search-planner-types.js";
import type { SearchCandidateBudget } from "./search-budget.js";
import type { SearchExecutionResult } from "./search-executor.js";
import type { SearchCompilerEvent } from "./search-plan-compiler.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchResult } from "./search-types.js";

export interface SearchPipelineResult {
  results: SearchResult[];
  meta: {
    query: {
      raw: string;
      residual: string;
    };
    extraction: {
      hints: Hint[];
    };
    compilerEvents: SearchCompilerEvent[];
    plan: SearchPlan;
    retrievalPlan: RetrievalPlan;
    retrievalPlans: RetrievalPlan[];
    budget: SearchCandidateBudget;
    timing: {
      extraction_ms: number;
      search_ms: number;
      total_ms: number;
    };
    fallback: {
      tierReached: number;
      constraintsRelaxed: string[];
      originalResultCount: number;
      recoveryGroups?: SearchRecoveryGroup[];
    };
    appliedSort?: SearchSort;
    appliedScope?: SearchScope;
  };
}

export function assembleSearchPipelineResult(input: {
  rawQuery: string;
  queryResidual: string;
  extractionHints: Hint[];
  compilerEvents: SearchCompilerEvent[];
  plan: SearchPlan;
  execution: SearchExecutionResult;
  recoveryGroups?: SearchRecoveryGroup[];
  appliedSort: SearchSort;
  appliedScope: SearchScope;
  timings: {
    extractionMs: number;
    searchMs: number;
    totalMs: number;
  };
}): SearchPipelineResult {
  return {
    results: input.execution.results,
    meta: {
      query: {
        raw: input.rawQuery,
        residual: input.queryResidual,
      },
      extraction: {
        hints: input.extractionHints,
      },
      compilerEvents: input.compilerEvents,
      plan: input.plan,
      retrievalPlan: input.execution.retrievalPlan,
      retrievalPlans: input.execution.retrievalPlans,
      budget: input.execution.budget,
      timing: {
        extraction_ms: Math.round(input.timings.extractionMs),
        search_ms: Math.round(input.timings.searchMs),
        total_ms: Math.round(input.timings.totalMs),
      },
      fallback: {
        tierReached: input.execution.tierReached,
        constraintsRelaxed: input.execution.constraintsRelaxed,
        originalResultCount: input.execution.originalResultCount,
        recoveryGroups: input.recoveryGroups,
      },
      appliedSort: input.appliedSort,
      appliedScope: input.appliedScope,
    },
  };
}
