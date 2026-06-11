import type { Hint, SearchPlan } from "./search-planner-types.js";
import type { SearchCompilerEvent } from "./search-plan-compiler.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchResult } from "./search-types.js";

export interface SearchPipelineResult {
  results: SearchResult[];
  totalResults: number;
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
  };
}
