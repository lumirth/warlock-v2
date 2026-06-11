import type {
  NormalizedSearchRequestDto,
  SearchUiPlanDto,
} from "@uiuc-course-search/query-types";
import type { Hint, SearchPlan } from "./search-planner-types.js";
import { buildAmbiguityActions } from "./search-ambiguity-actions.js";
import { buildSearchChips } from "./search-chip-presenter.js";

type SearchUiPlanRequestContext = {
  executableRequest: NormalizedSearchRequestDto;
  interpretedRequest: NormalizedSearchRequestDto;
};

export function buildSearchUiPlan(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  requests: SearchUiPlanRequestContext,
): SearchUiPlanDto {
  const interpretedFilters = requests.interpretedRequest.filters;
  return {
    chips: buildSearchChips(
      hints,
      plan,
      residual,
      requests.executableRequest,
    ),
    ambiguityActions: buildAmbiguityActions(
      plan.ambiguities ?? [],
      requests.executableRequest,
      residual,
      interpretedFilters,
    ),
  };
}
