import type { SearchPlan } from "../search-planner-types.js";
import type { SearchResult } from "../search-types.js";
import { rankingComponentsForResult } from "./components.js";
import { componentTotal } from "./score-utils.js";

export {
  applyTermRankingPolicy,
  buildTermPriorityMap,
  compareRankedSearchResults,
  type RankingTermInfo,
} from "./term-ordering.js";
export {
  isSearchSort,
  sortValueForResult,
} from "./sort-policy.js";
export {
  applyFinalOrderingControls,
  type FinalOrderingControls,
} from "./final-ordering.js";

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
