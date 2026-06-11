import {
  ANY_GENED_DISPLAY_LABEL,
  formatGenEdDisplayLabel,
  isGenericAnyRequirementFilter,
  singleRequirementFilter,
  type NormalizedSearchRequestDto,
  type SearchChipDto,
  type SearchChipType,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import { removeSearchIntentRequest } from "./search-refinement-requests.js";

export function buildRequestFilterChips(
  request: NormalizedSearchRequestDto,
): SearchChipDto[] {
  const filters = request.filters;
  const chips: SearchChipDto[] = [];

  if (filters.subject && filters.number) {
    chips.push(filterChip(request, "courseCode", `Course ${filters.subject} ${filters.number}`, `${filters.subject} ${filters.number}`, {
      subject: filters.subject,
      number: filters.number,
    }));
  } else {
    if (filters.subject) {
      chips.push(filterChip(request, "subject", `Subject ${filters.subject}`, filters.subject, {
        subject: filters.subject,
      }));
    }
    if (filters.number) {
      chips.push(filterChip(request, "courseCode", `Course number ${filters.number}`, filters.number, {
        number: filters.number,
      }));
    }
  }

  if (filters.instructor) {
    chips.push(filterChip(request, "instructor", `Instructor ${filters.instructor}`, filters.instructor, {
      instructor: filters.instructor,
    }));
  }
  if (filters.term) {
    const label = filters.year
      ? `${capitalize(filters.term)} ${filters.year}`
      : `${capitalize(filters.term)} term`;
    chips.push(filterChip(request, "term", label, filters.term, {
      term: filters.term,
      ...(filters.year ? { year: filters.year } : {}),
    }));
  } else if (filters.year) {
    chips.push(filterChip(request, "term", `Year ${filters.year}`, String(filters.year), {
      year: filters.year,
    }));
  }
  if (filters.requirement) {
    chips.push(...requirementChips(request, filters.requirement));
  }
  if (filters.credits !== undefined) {
    chips.push(filterChip(request, "credits", `${filters.credits} credits`, String(filters.credits), {
      credits: filters.credits,
    }));
  }
  if (filters.days) {
    chips.push(filterChip(request, "days", `Meets ${filters.days}`, filters.days, {
      days: filters.days,
    }));
  }
  if (filters.time) {
    chips.push(filterChip(request, "time", `${capitalize(filters.time)} classes`, filters.time, {
      time: filters.time,
    }));
  }
  if (filters.partOfTerm) {
    chips.push(filterChip(request, "partOfTerm", `Part of term ${filters.partOfTerm}`, filters.partOfTerm, {
      partOfTerm: filters.partOfTerm,
    }));
  }
  if (filters.online !== undefined) {
    chips.push(filterChip(request, "online", filters.online ? "Online" : "In person", String(filters.online), {
      online: filters.online,
    }));
  }
  if (filters.status) {
    chips.push(filterChip(request, "status", `${capitalize(filters.status)} sections`, filters.status, {
      status: filters.status,
    }));
  }
  if (filters.workload) {
    chips.push(filterChip(request, "workload", `${capitalize(filters.workload)} workload`, filters.workload, {
      workload: filters.workload,
    }));
  }
  if (filters.level !== undefined) {
    chips.push(filterChip(request, "level", `${filters.level} level`, String(filters.level), {
      level: filters.level,
    }));
  }

  return chips;
}

export function requestFilterCoversHint(
  filters: SearchRequestFiltersDto,
  type: SearchChipType,
): boolean {
  switch (type) {
    case "courseCode":
      return filters.subject !== undefined || filters.number !== undefined;
    case "term":
      return filters.term !== undefined || filters.year !== undefined;
    case "levelBoost":
    case "crn":
    case "negation":
    case "semantic":
      return false;
    default:
      return filters[type] !== undefined;
  }
}

function requirementChips(
  request: NormalizedSearchRequestDto,
  requirement: NonNullable<SearchRequestFiltersDto["requirement"]>,
): SearchChipDto[] {
  if (requirement.mode === "any" && isGenericAnyRequirementFilter(requirement.codes)) {
    return [
      filterChip(request, "requirement", ANY_GENED_DISPLAY_LABEL, "any", {
        requirement,
      }),
    ];
  }

  return requirement.codes.map((code) =>
    filterChip(request, "requirement", formatGenEdDisplayLabel(code), code, {
      requirement: singleRequirementFilter(code),
    }),
  );
}

function filterChip(
  request: NormalizedSearchRequestDto,
  type: SearchChipType,
  label: string,
  value: string,
  filter: Partial<SearchRequestFiltersDto>,
): SearchChipDto {
  return {
    id: `manual-${type}-${value}`,
    type,
    label,
    value,
    removeRequest: removeSearchIntentRequest(request, filter, undefined),
  };
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
