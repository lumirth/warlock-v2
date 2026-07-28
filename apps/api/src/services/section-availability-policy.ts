import type {
  CourseSectionAvailabilityDto,
  CourseSectionAvailabilityStatus,
  SearchStatusFilter,
} from "@uiuc-course-search/query-types";

type SectionAvailabilityInput = {
  status?: string | null;
  statusCode?: string | null;
  sectionStatusCode?: string | null;
};

const STATUS_LABELS: Record<CourseSectionAvailabilityStatus, string> = {
  open: "Open",
  restricted: "Restricted",
  waitlisted: "Waitlisted",
  closed: "Closed",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

const SEARCH_STATUS_RAW_LABELS: Record<SearchStatusFilter, readonly string[]> = {
  open: ["Open"],
  available: ["Open", "Restricted"],
  closed: ["Closed"],
};

export function rawSectionStatusesForSearchFilter(
  status: SearchStatusFilter,
): readonly string[] {
  return SEARCH_STATUS_RAW_LABELS[status];
}

export function normalizeSectionAvailability(
  input: SectionAvailabilityInput,
): CourseSectionAvailabilityDto {
  const rawStatus = clean(input.status);
  const statusCode = clean(input.statusCode);
  const sectionStatusCode = clean(input.sectionStatusCode);
  const rawStatusClassification = normalizedSectionAvailabilityStatus(rawStatus);
  const status = [
    rawStatusClassification,
    normalizedSectionAvailabilityStatus(sectionStatusCode),
    normalizedSectionAvailabilityStatus(statusCode),
  ].find((candidate) => candidate !== "unknown") ?? "unknown";

  return {
    status,
    label: rawStatusClassification === "unknown"
      ? STATUS_LABELS[status]
      : rawStatus ?? STATUS_LABELS[status],
    rawStatus,
    statusCode,
    sectionStatusCode,
  };
}

function normalizedSectionAvailabilityStatus(
  value: string | null,
): CourseSectionAvailabilityStatus {
  const normalized = value?.toLowerCase() ?? "";
  if (!normalized) return "unknown";
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("wait")) return "waitlisted";
  if (normalized.includes("restrict")) return "restricted";
  if (normalized.includes("closed") || normalized === "c") return "closed";
  if (normalized.includes("open") || normalized === "a") return "open";
  return "unknown";
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
