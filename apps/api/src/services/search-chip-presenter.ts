import {
  ANY_GENED_DISPLAY_LABEL,
  effectiveRequirementFilter,
  formatGenEdDisplayLabel,
  type NormalizedSearchRequestDto,
  type SearchChipDto,
  type SearchChipSource,
  singleRequirementFilter,
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
import { hasIntroductoryGatewayIntent } from "./search-intent.js";

export function buildSearchChips(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  request: NormalizedSearchRequestDto,
): SearchChipDto[] {
  const requirement = effectiveRequirementFilter(plan.filters);
  const chips = hints
    .filter((hint) => !shouldHideHintChip(hint, plan))
    .filter((hint) => !shouldReplaceHintWithStructuredRequirementChip(
      hint,
      request,
      requirement,
    ))
    .map((hint, index): SearchChipDto => ({
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

  if (shouldShowStructuredRequirementChips(request, requirement)) {
    chips.push(...buildStructuredRequirementChips(request, requirement));
  } else if (shouldShowGenericRequirementChip(hints, plan.filters) && requirement) {
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
      removable: false,
      editable: false,
    });
  }

  return chips;
}

function shouldHideHintChip(hint: Hint, plan: SearchPlan): boolean {
  if (hint.type !== "levelBoost") return false;
  if (hint.value !== 100 && hint.value !== "introductory") return false;
  return !hasIntroductoryGatewayIntent(plan);
}

function shouldReplaceHintWithStructuredRequirementChip(
  hint: Hint,
  request: NormalizedSearchRequestDto,
  requirement: ReturnType<typeof effectiveRequirementFilter>,
): boolean {
  return hint.type === "requirement"
    && Boolean(request.filters.requirement)
    && Boolean(requirement);
}

function shouldShowStructuredRequirementChips(
  request: NormalizedSearchRequestDto,
  requirement: ReturnType<typeof effectiveRequirementFilter>,
): requirement is NonNullable<ReturnType<typeof effectiveRequirementFilter>> {
  if (!request.filters.requirement || !requirement) return false;
  return requirement.codes.length > 0;
}

function buildStructuredRequirementChips(
  request: NormalizedSearchRequestDto,
  requirement: NonNullable<ReturnType<typeof effectiveRequirementFilter>>,
): SearchChipDto[] {
  if (requirement.mode === "any" && isGenericAnyRequirementFilter(requirement.codes)) {
    return [{
      id: "requirement-any",
      type: "requirement",
      label: ANY_GENED_DISPLAY_LABEL,
      value: "any",
      source: "manual_override",
      removable: true,
      editable: false,
      action: removeSearchIntentAction(request, { requirement }, "gen ed"),
    }];
  }

  return requirement.codes.map((code): SearchChipDto => ({
    id: `requirement-${code}`,
    type: "requirement",
    label: formatGenEdDisplayLabel(code),
    value: code,
    source: "manual_override",
    removable: true,
    editable: false,
    action: removeSearchIntentAction(
      request,
      { requirement: singleRequirementFilter(code) },
      code,
    ),
  }));
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
