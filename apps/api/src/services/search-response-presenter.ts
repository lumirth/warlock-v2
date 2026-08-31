import {
  formatGenEdDisplayLabel,
  normalizeSearchRequestDto,
  singleRequirementFilter,
  type NormalizedSearchRequestDto,
  type SearchChipDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
  type SearchRequestPaginationDto,
  type SearchResponseDto,
} from "@uiuc-course-search/query-types";
import type { Hint, SearchFilters } from "./search-planner-types.js";
import { presentSearchCourseResult } from "./search-result-presentation.js";
import type { SearchPipelineResult } from "./search-types.js";

export function presentSearchResponse(input: {
  request: NormalizedSearchRequestDto;
  pagination: SearchRequestPaginationDto;
  result: SearchPipelineResult;
}): SearchResponseDto {
  const { request, pagination, result } = input;
  const { limit, offset } = pagination;
  const applied = result.meta.controls;
  const nextRequest = normalizeSearchRequestDto({ ...request, ...applied });
  const interpretedRequest = normalizeSearchRequestDto({
    query: result.meta.query.residual,
    filters: publicFilters(result.meta.plan.filters, result.meta.hints, request.filters),
    ...applied,
  });
  const failed = result.meta.failedLanes;
  const page = result.results.slice(offset, offset + limit);
  const hasMore = result.results.length > offset + limit;
  const chips = searchChips(result.meta.hints, result.meta.query.residual, nextRequest);

  return {
    results: page.map(searchResult => presentSearchCourseResult(searchResult, {
      plan: result.meta.plan,
      hints: result.meta.hints,
    })),
    meta: {
      nextRequest,
      interpretedRequest,
      ui: {
        chips,
        ambiguityActions: (result.meta.plan.ambiguities ?? []).flatMap((ambiguity, group) =>
          ambiguity.alternatives.map((alternative, index) => ({
            id: `${group}-${index}-${alternative.type}-${alternative.value}`,
            label: alternative.label,
            nextRequest: ambiguityRequest(nextRequest, result.meta.query.residual, alternative),
          }))),
      },
      retrieval: {
        degraded: failed.length > 0,
        ...(applied.sort.field !== "relevance" && result.meta.lanes.includes("topic_semantic")
          ? { sortLimitedToRetrievedWindow: true as const }
          : {}),
      },
    },
    pagination: {
      totalResults: result.totalResults,
      browseableResults: result.results.length,
      limit,
      offset,
      hasMore,
    },
  };
}

function publicFilters(
  filters: SearchFilters,
  hints: Hint[],
  requested: SearchRequestFiltersDto,
): SearchRequestFiltersDto {
  const instructor = requested.instructor ?? hints.find(hint => hint.type === "instructor")?.metadata.raw;
  return compact({
    subject: filters.subject,
    number: filters.number,
    instructor,
    term: filters.term,
    year: filters.year,
    requirement: filters.requirement,
    credits: filters.credits,
    days: filters.days,
    time: filters.time,
    partOfTerm: filters.partOfTerm,
    online: filters.online,
    status: filters.status,
    instructorDifficulty: filters.instructorDifficulty,
    level: filters.level,
  });
}

function searchChips(
  hints: Hint[],
  residual: string,
  request: NormalizedSearchRequestDto,
): SearchChipDto[] {
  const chips: SearchChipDto[] = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    const value = displayValue(hint);
    const id = `${hint.type}:${value}`;
    if (!value || seen.has(id)) continue;
    seen.add(id);
    const filters = { ...request.filters };
    const key = hintFilterKey(hint.type);
    if (key) delete filters[key];
    if (hint.type === "term" && hint.value.year !== undefined) delete filters.year;
    if (hint.type === "courseCode") delete filters.subject;
    chips.push({
      id,
      type: hint.type,
      label: label(hint, value),
      removeRequest: {
        ...request,
        query: removePhrase(request.query, hint.metadata.raw),
        filters,
      },
    });
  }
  if (residual && !seen.has(`semantic:${residual}`)) {
    chips.push({
      id: `semantic:${residual}`,
      type: "semantic",
      label: `Topic: ${residual}`,
      removeRequest: { ...request, query: removePhrase(request.query, residual) },
    });
  }
  return chips;
}

function hintFilterKey(type: Hint["type"]): keyof SearchRequestFiltersDto | null {
  if (type === "courseCode") return "number";
  if (type === "levelBoost" || type === "negation" || type === "semantic" || type === "crn") return null;
  return type as keyof SearchRequestFiltersDto;
}

function displayValue(hint: Hint): string {
  if (hint.type === "courseCode") return `${hint.value.subject} ${hint.value.number}`;
  if (hint.type === "requirement") return requirementValue(hint.value);
  if (hint.type === "term") return hint.value.year === undefined
    ? hint.value.term
    : `${hint.value.term} ${hint.value.year}`;
  if (hint.type === "negation") return hint.value.value;
  return String(hint.value);
}

function requirementValue(value: Hint["value"]): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "codes" in value && Array.isArray(value.codes)) {
    return value.codes.join(", ");
  }
  return "";
}

function label(hint: Hint, value: string): string {
  const labels: Partial<Record<Hint["type"], string>> = {
    subject: "Subject", instructor: "Instructor", days: "Days", time: "Time",
    level: "Level", levelBoost: "Preferred level", credits: "Credits", online: "Delivery",
    status: "Status", instructorDifficulty: "Instructor difficulty", term: "Term",
    partOfTerm: "Part of term", crn: "CRN", courseCode: "Course", negation: "Avoid",
  };
  if (hint.type === "requirement") return formatGenEdDisplayLabel(value.split(","));
  if (hint.type === "online") return value === "true" ? "Online" : "In person";
  return `${labels[hint.type] ?? hint.type}: ${value}`;
}

function ambiguityRequest(
  request: NormalizedSearchRequestDto,
  residual: string,
  alternative: { type: string; value: string },
): SearchRequestDto {
  const filters = { ...request.filters };
  if (alternative.type === "subject") filters.subject = alternative.value.toUpperCase();
  if (alternative.type === "requirement") filters.requirement = singleRequirementFilter(alternative.value);
  return { ...request, query: residual, filters };
}

function compact(filters: SearchRequestFiltersDto): SearchRequestFiltersDto {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as SearchRequestFiltersDto;
}

function removePhrase(text: string, phrase: string): string {
  if (!phrase) return text;
  return text.replace(phrase, " ").replace(/\s+/g, " ").trim();
}
