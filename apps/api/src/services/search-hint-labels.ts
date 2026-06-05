import {
  effectiveRequirementFilter,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  isSearchWorkloadFilter,
  singleRequirementFilter,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import type {
  CourseCodeValue,
  Hint,
  NegationValue,
  SearchPlan,
  TermValue,
} from "./search-planner-types.js";

export function formatResolvedHintLabel(
  hint: Hint,
  plan: SearchPlan,
  residual = "",
): string {
  if (isSubjectHintResolvedAsRequirement(hint, plan)) {
    return `Requirement ${formatHintValue(hint.value)}`;
  }

  return formatHintLabel(hint, residual);
}

export function formatResolvedHintValue(
  hint: Hint,
  plan: SearchPlan,
  residual: string,
): string {
  if (isSubjectHintResolvedAsRequirement(hint, plan)) {
    return formatHintValue(hint.value).toUpperCase();
  }

  return formatDisplayHintValue(hint, residual);
}

export function formatDisplayHintValue(hint: Hint, residual: string): string {
  const value = formatHintValue(hint.value);
  if (hint.type !== "instructor") {
    return value;
  }

  return trimTrailingResidual(value, residual) ?? value;
}

export function removeTextForHint(hint: Hint, residual: string): string {
  if (hint.type !== "instructor") {
    return hint.metadata.raw;
  }

  return trimTrailingResidual(hint.metadata.raw, residual) ?? hint.metadata.raw;
}

export function resolvedFilterFromHint(
  hint: Hint,
  plan: SearchPlan,
): Partial<SearchRequestFiltersDto> {
  if (isSubjectHintResolvedAsRequirement(hint, plan)) {
    return { requirement: singleRequirementFilter(formatHintValue(hint.value)) };
  }

  return filterFromHint(hint);
}

export function isEditableHint(hint: Hint): boolean {
  return hint.type !== "crn" && hint.type !== "negation";
}

function formatHintLabel(hint: Hint, residual = ""): string {
  switch (hint.type) {
    case "courseCode": {
      const value = hint.value as CourseCodeValue;
      return `Course ${value.subject} ${value.number}`.trim();
    }
    case "crn":
      return `CRN ${formatHintValue(hint.value)}`;
    case "subject":
      return `Subject ${formatHintValue(hint.value)}`;
    case "instructor":
      return `Instructor ${formatDisplayHintValue(hint, residual)}`;
    case "days":
      return `Meets ${formatHintValue(hint.value)}`;
    case "time":
      return `${capitalize(formatHintValue(hint.value))} classes`;
    case "level":
      return `${formatHintValue(hint.value)} level`;
    case "levelBoost":
      if (hint.value === 100) {
        return "Introductory courses";
      }
      return `${formatHintValue(hint.value)} level preference`;
    case "credits":
      return `${formatHintValue(hint.value)} credits`;
    case "online":
      return hint.value ? "Online" : "In person";
    case "status":
      return `${capitalize(formatHintValue(hint.value))} sections`;
    case "workload":
      return `${capitalize(formatHintValue(hint.value))} workload`;
    case "requirement":
      return `Requirement ${formatHintValue(hint.value)}`;
    case "term": {
      const term = hint.value as TermValue;
      return `${capitalize(term.term)} ${term.year}`;
    }
    case "partOfTerm":
      return `Part of term ${formatHintValue(hint.value)}`;
    case "negation": {
      const negation = hint.value as NegationValue;
      return `No ${negation.value}`;
    }
  }
}

function filterFromHint(hint: Hint): Partial<SearchRequestFiltersDto> {
  switch (hint.type) {
    case "courseCode": {
      const value = hint.value as CourseCodeValue;
      return {
        subject: value.subject || undefined,
        number: value.number,
      };
    }
    case "subject":
      return { subject: formatHintValue(hint.value).toUpperCase() };
    case "crn":
      return {};
    case "days":
      return { days: formatHintValue(hint.value) };
    case "time": {
      const time = formatHintValue(hint.value);
      return isSearchTimeFilter(time) ? { time } : {};
    }
    case "credits":
      return { credits: Number(hint.value) };
    case "level": {
      const level = Number(hint.value);
      return isSearchLevelFilter(level) ? { level } : {};
    }
    case "online":
      return { online: Boolean(hint.value) };
    case "status": {
      const status = formatHintValue(hint.value);
      return isSearchStatusFilter(status) ? { status } : {};
    }
    case "workload":
      return isSearchWorkloadFilter(hint.value)
        ? { workload: hint.value }
        : {};
    case "requirement":
      return { requirement: singleRequirementFilter(formatHintValue(hint.value)) };
    case "term": {
      const value = hint.value as TermValue;
      return {
        ...(isSearchTermFilter(value.term) ? { term: value.term } : {}),
        year: value.year,
      };
    }
    case "partOfTerm":
      return { partOfTerm: formatHintValue(hint.value) };
    default:
      return {};
  }
}

function isSubjectHintResolvedAsRequirement(
  hint: Hint,
  plan: SearchPlan,
): boolean {
  const requirement = effectiveRequirementFilter(plan.filters);
  return hint.type === "subject"
    && !plan.filters.subject
    && requirement?.mode === "single"
    && requirement.codes[0] === formatHintValue(hint.value).toUpperCase();
}

function formatHintValue(value: Hint["value"]): string {
  if (typeof value === "object" && value !== null) {
    if ("subject" in value && "number" in value) {
      return `${value.subject} ${value.number}`.trim();
    }
    if ("term" in value && "year" in value) {
      return `${value.term} ${value.year}`;
    }
    if ("target" in value && "value" in value) {
      return value.value;
    }
  }

  return String(value);
}

function trimTrailingResidual(value: string, residual: string): string | null {
  const valueTokens = value.trim().split(/\s+/);
  const residualTokens = residual.trim().split(/\s+/).filter(Boolean);
  if (valueTokens.length <= 1 || residualTokens.length === 0) {
    return null;
  }

  const maxSuffixTokens = Math.min(
    residualTokens.length,
    valueTokens.length - 1,
  );
  for (let tokenCount = maxSuffixTokens; tokenCount >= 1; tokenCount--) {
    const suffix = residualTokens.slice(0, tokenCount).join(" ").toLowerCase();
    const candidate = valueTokens.slice(-tokenCount).join(" ").toLowerCase();
    if (candidate === suffix) {
      return valueTokens.slice(0, -tokenCount).join(" ");
    }
  }

  return null;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
