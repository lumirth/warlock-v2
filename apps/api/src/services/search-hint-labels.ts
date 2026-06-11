import {
  formatGenEdDisplayLabel,
  singleRequirementFilter,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import type {
  Hint,
  SearchPlan,
} from "./search-planner-types.js";

export function presentResolvedHint(
  hint: Hint,
  plan: SearchPlan,
  residual = "",
): {
  label: string;
  value: string;
  filter: Partial<SearchRequestFiltersDto>;
  removeText: string;
} {
  const resolvedAsRequirement = isSubjectHintResolvedAsRequirement(hint, plan);
  const rawValue = formatHintValue(hint.value);
  return {
    label: resolvedAsRequirement
      ? formatGenEdDisplayLabel(rawValue)
      : formatHintLabel(hint, residual),
    value: resolvedAsRequirement
      ? rawValue.toUpperCase()
      : formatDisplayHintValue(hint, residual),
    filter: resolvedAsRequirement
      ? { requirement: singleRequirementFilter(rawValue) }
      : filterFromHint(hint, residual),
    removeText: hint.type === "instructor"
      ? trimTrailingResidual(hint.metadata.raw, residual) ?? hint.metadata.raw
      : hint.metadata.raw,
  };
}

export function formatDisplayHintValue(hint: Hint, residual: string): string {
  const value = formatHintValue(hint.value);
  if (hint.type !== "instructor") {
    return value;
  }

  return trimTrailingResidual(value, residual) ?? value;
}

function formatHintLabel(hint: Hint, residual = ""): string {
  switch (hint.type) {
    case "courseCode":
      return `Course ${hint.value.subject} ${hint.value.number}`.trim();
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
      return formatGenEdDisplayLabel(formatHintValue(hint.value));
    case "term":
      return `${capitalize(hint.value.term)} ${hint.value.year}`;
    case "partOfTerm":
      return `Part of term ${formatHintValue(hint.value)}`;
    case "negation":
      return `No ${hint.value.value}`;
  }
}

function filterFromHint(
  hint: Hint,
  residual: string,
): Partial<SearchRequestFiltersDto> {
  switch (hint.type) {
    case "courseCode":
      return {
        subject: hint.value.subject || undefined,
        number: hint.value.number,
      };
    case "subject":
      return { subject: formatHintValue(hint.value).toUpperCase() };
    case "instructor":
      return { instructor: formatDisplayHintValue(hint, residual) };
    case "crn":
      return {};
    case "days":
      return { days: hint.value };
    case "time":
      return { time: hint.value };
    case "credits":
      return { credits: hint.value };
    case "level":
      return { level: hint.value };
    case "online":
      return { online: hint.value };
    case "status":
      return { status: hint.value };
    case "workload":
      return { workload: hint.value };
    case "requirement":
      return { requirement: singleRequirementFilter(formatHintValue(hint.value)) };
    case "term":
      return {
        term: hint.value.term,
        year: hint.value.year,
      };
    case "partOfTerm":
      return { partOfTerm: hint.value };
    default:
      return {};
  }
}

function isSubjectHintResolvedAsRequirement(
  hint: Hint,
  plan: SearchPlan,
): boolean {
  const requirement = plan.filters.requirement;
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
