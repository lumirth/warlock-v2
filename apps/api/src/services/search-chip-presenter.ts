import {
  ANY_GENED_DISPLAY_LABEL,
  isGenericAnyRequirementFilter,
  type NormalizedSearchRequestDto,
  type SearchChipDto,
} from "@uiuc-course-search/query-types";
import { removeSearchIntentRequest } from "./search-refinement-requests.js";
import type {
  Hint,
  SearchFilters,
  SearchPlan,
} from "./search-planner-types.js";
import {
  formatResolvedHintLabel,
  formatResolvedHintValue,
  removeTextForHint,
  resolvedFilterFromHint,
} from "./search-hint-labels.js";
import {
  buildRequestFilterChips,
  requestFilterCoversHint,
} from "./search-request-filter-chips.js";

export function buildSearchChips(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  request: NormalizedSearchRequestDto,
): SearchChipDto[] {
  const requirement = plan.filters.requirement;
  const chips = hints
    .filter((hint) => !shouldHideHintChip(hint, plan))
    .filter((hint) => !requestFilterCoversHint(request.filters, hint.type))
    .map((hint, index): SearchChipDto => ({
      id: `${hint.type}-${index}`,
      type: hint.type,
      label: formatResolvedHintLabel(hint, plan, residual),
      value: formatResolvedHintValue(hint, plan, residual),
      removeRequest: removeSearchIntentRequest(
        request,
        resolvedFilterFromHint(hint, plan, residual),
        removeTextForHint(hint, residual),
      ),
    }));

  chips.push(...buildRequestFilterChips(request));

  if (shouldShowGenericRequirementChip(hints, plan.filters, request) && requirement) {
    chips.push({
      id: "requirement-any",
      type: "requirement",
      label: ANY_GENED_DISPLAY_LABEL,
      value: "any",
      removeRequest: removeSearchIntentRequest(request, { requirement }, "gen ed"),
    });
  }

  if (residual) {
    chips.push({
      id: "semantic-query",
      type: "semantic",
      label: `Topic: ${residual}`,
      value: residual,
      removeRequest: removeSearchIntentRequest(request, undefined, residual),
    });
  }

  return chips;
}

function shouldHideHintChip(hint: Hint, plan: SearchPlan): boolean {
  if (hint.type !== "levelBoost") return false;
  if (hint.value !== 100) return false;
  return plan.introductoryGateway !== true;
}

function shouldShowGenericRequirementChip(
  hints: Hint[],
  filters: SearchFilters,
  request: NormalizedSearchRequestDto,
): boolean {
  const requirement = filters.requirement;
  return requirement?.mode === "any"
    && isGenericAnyRequirementFilter(requirement.codes)
    && request.filters.requirement === undefined
    && !hints.some((hint) => hint.type === "requirement");
}
