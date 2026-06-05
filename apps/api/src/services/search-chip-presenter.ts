import {
  ANY_GENED_DISPLAY_LABEL,
  effectiveRequirementFilter,
  type NormalizedSearchRequestDto,
  type SearchChipDto,
  type SearchChipSource,
} from "@uiuc-course-search/query-types";
import { removeSearchIntentAction } from "../dto/search-actions.js";
import { isGenericAnyRequirementFilter } from "./requirement-codes.js";
import type {
  Hint,
  SearchFilters,
  SearchPlan,
} from "./search-planner-types.js";
import {
  formatResolvedHintLabel,
  formatResolvedHintValue,
  isEditableHint,
  removeTextForHint,
  resolvedFilterFromHint,
} from "./search-hint-labels.js";

export function buildSearchChips(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  request: NormalizedSearchRequestDto,
): SearchChipDto[] {
  const chips = hints.map((hint, index): SearchChipDto => ({
    id: `${hint.type}-${index}`,
    type: hint.type,
    label: formatResolvedHintLabel(hint, plan, residual),
    value: formatResolvedHintValue(hint, plan, residual),
    source: sourceFromHint(hint),
    removable: true,
    editable: isEditableHint(hint),
    action: removeSearchIntentAction(
      request,
      resolvedFilterFromHint(hint, plan, residual),
      removeTextForHint(hint, residual),
    ),
  }));

  const requirement = effectiveRequirementFilter(plan.filters);
  if (shouldShowGenericRequirementChip(hints, plan.filters) && requirement) {
    chips.push({
      id: "requirement-any",
      type: "requirement",
      label: ANY_GENED_DISPLAY_LABEL,
      value: "any",
      source: "natural_language",
      removable: true,
      editable: false,
      action: removeSearchIntentAction(request, { requirement }, "gen ed"),
    });
  }

  if (residual) {
    chips.push({
      id: "semantic-query",
      type: "semantic",
      label: `Topic: ${residual}`,
      value: residual,
      source: "natural_language",
      removable: true,
      editable: true,
      action: removeSearchIntentAction(request, undefined, residual),
    });
  }

  const existingLabels = new Set(chips.map((chip) => chip.label.toLowerCase()));
  for (const assumption of plan.rescue?.assumptions ?? []) {
    if (shouldHideAssumptionChip(assumption.kind, hints, plan.filters)) {
      continue;
    }
    if (existingLabels.has(assumption.label.toLowerCase())) {
      continue;
    }
    chips.push({
      id: `assumption-${assumption.kind}`,
      type: "assumption",
      label: assumption.label,
      value: assumption.kind,
      source: "natural_language",
      removable: true,
      editable: false,
      action: removeSearchIntentAction(
        request,
        undefined,
        textToRemoveForAssumption(assumption.kind, residual),
      ),
    });
  }

  return chips;
}

function sourceFromHint(hint: Hint): SearchChipSource {
  return hint.metadata.source === "manual"
    ? "manual_override"
    : "natural_language";
}

function shouldHideAssumptionChip(
  kind: string,
  hints: Hint[],
  filters: SearchFilters,
): boolean {
  if (
    kind === "schedule_fit"
    || kind === "requirement_match"
    || kind === "requirement_ambiguous"
  ) {
    return true;
  }

  if (kind === "low_workload") {
    return filters.workload === "easy"
      || hints.some((hint) => hint.type === "workload" && hint.value === "easy");
  }

  if (kind === "online_preferred") {
    return filters.online !== undefined || hints.some((hint) => hint.type === "online");
  }

  if (kind === "credit_count") {
    return filters.credits !== undefined || hints.some((hint) => hint.type === "credits");
  }

  return false;
}

function shouldShowGenericRequirementChip(
  hints: Hint[],
  filters: SearchFilters,
): boolean {
  const requirement = effectiveRequirementFilter(filters);
  return requirement?.mode === "any"
    && isGenericAnyRequirementFilter(requirement.codes)
    && !hints.some((hint) => hint.type === "requirement");
}

function textToRemoveForAssumption(
  kind: string,
  residual: string,
): string | undefined {
  if (kind === "low_writing") return "no essays";
  if (kind === "low_exams") return "no tests";
  if (kind === "low_math") return "not math";
  if (kind === "low_workload") return "easy";
  if (kind === "no_listed_prereq") return "no prereq";
  if (kind === "online_preferred") return "online";
  return residual || undefined;
}
