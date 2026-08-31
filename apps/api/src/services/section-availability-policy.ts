import type {
  CourseSectionAvailabilityDto,
  CourseSectionAvailabilityStatus,
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

const CLASSIFICATIONS: Array<[RegExp, CourseSectionAvailabilityStatus]> = [
  [/cancel/, "cancelled"],
  [/wait/, "waitlisted"],
  [/restrict/, "restricted"],
  [/closed|^c$/, "closed"],
  [/open|^a$/, "open"],
];

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
    statusCode,
    sectionStatusCode,
  };
}

function normalizedSectionAvailabilityStatus(
  value: string | null,
): CourseSectionAvailabilityStatus {
  const normalized = value?.toLowerCase() ?? "";
  return CLASSIFICATIONS.find(([pattern]) => pattern.test(normalized))?.[1] ?? "unknown";
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
