import {
  singleRequirementFilter,
  type NormalizedSearchRequestDto,
  type SearchAmbiguityActionDto,
  type SearchRequestFiltersDto,
  type SearchUiPlanDto,
} from "@uiuc-course-search/query-types";
import type { Ambiguity, Hint, SearchPlan } from "./search-planner-types.js";
import { buildSearchChips } from "./search-chip-presenter.js";
import { ambiguitySearchRequest } from "./search-refinement-requests.js";

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

function buildAmbiguityActions(
  ambiguities: Ambiguity[],
  request: NormalizedSearchRequestDto,
  residual: string,
  baseFilters: SearchRequestFiltersDto,
): SearchAmbiguityActionDto[] {
  return ambiguities.flatMap((ambiguity, ambiguityIndex) =>
    ambiguity.alternatives.map((alternative, alternativeIndex) => ({
      id: `${ambiguityIndex}-${alternativeIndex}-${alternative.type}-${alternative.value}`,
      term: ambiguity.term,
      label: alternative.label,
      nextRequest: ambiguitySearchRequest(
        request,
        baseFilters,
        ambiguityFilter(alternative.type, alternative.value),
        residual,
      ),
    })),
  );
}

function ambiguityFilter(
  type: string,
  value: string,
): Partial<SearchRequestFiltersDto> {
  if (type === "subject") return { subject: value.toUpperCase() };
  if (type === "requirement") {
    return { requirement: singleRequirementFilter(value) };
  }
  return {};
}
