import {
  type NormalizedSearchRequestDto,
  type SearchAmbiguityActionDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import { ambiguitySearchAction } from "../dto/search-actions.js";
import type { Ambiguity } from "./search-planner-types.js";

export function buildAmbiguityActions(
  ambiguities: Ambiguity[],
  request: NormalizedSearchRequestDto,
  residual: string,
  baseFilters: SearchRequestFiltersDto,
): SearchAmbiguityActionDto[] {
  return ambiguities.flatMap((ambiguity, ambiguityIndex) =>
    ambiguity.alternatives.map((alternative, alternativeIndex) => {
      const filter = ambiguityFilter(alternative.type, alternative.value);

      return {
        id: `${ambiguityIndex}-${alternativeIndex}-${alternative.type}-${alternative.value}`,
        term: ambiguity.term,
        label: alternative.label,
        action: ambiguitySearchAction(request, baseFilters, filter, residual),
      };
    }),
  );
}

function ambiguityFilter(
  type: string,
  value: string,
): Partial<SearchRequestFiltersDto> {
  if (type === "subject") {
    return { subject: value.toUpperCase() };
  }

  if (type === "requirement") {
    return { requirement: value.toUpperCase() };
  }

  return {};
}
