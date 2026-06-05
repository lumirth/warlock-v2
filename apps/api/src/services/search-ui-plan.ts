import type {
  NormalizedSearchRequestDto,
  SearchUiPlanDto,
} from "@uiuc-course-search/query-types";
import type { Hint, SearchPlan } from "./search-planner-types.js";
import { buildAmbiguityActions } from "./search-ambiguity-actions.js";
import { buildSearchChips } from "./search-chip-presenter.js";
import { publicFiltersFromPlan } from "./search-interpreted-request.js";

export { buildInterpretedSearchRequest } from "./search-interpreted-request.js";

export function buildSearchUiPlan(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  request: NormalizedSearchRequestDto,
): SearchUiPlanDto {
  const interpretedFilters = publicFiltersFromPlan(hints, plan.filters, residual);
  return {
    chips: buildSearchChips(hints, plan, residual, request),
    ambiguityActions: buildAmbiguityActions(
      plan.ambiguities ?? [],
      request,
      residual,
      interpretedFilters,
    ),
  };
}
