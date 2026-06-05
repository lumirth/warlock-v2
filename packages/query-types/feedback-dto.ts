export const FEEDBACK_KIND_VALUES = [
  "search_results",
  "course_result",
  "score",
  "external_link",
  "data_freshness",
  "copy_confusion",
  "other",
] as const;

export type FeedbackKind = (typeof FEEDBACK_KIND_VALUES)[number];

export const FEEDBACK_ISSUE_VALUES = [
  "expected_different_results",
  "missing_course",
  "wrong_score",
  "broken_link",
  "stale_data",
  "confusing_copy",
  "other",
] as const;

export type FeedbackIssue = (typeof FEEDBACK_ISSUE_VALUES)[number];

export const FEEDBACK_PAGE_VALUES = ["search", "course"] as const;

export type FeedbackPage = (typeof FEEDBACK_PAGE_VALUES)[number];

export const FEEDBACK_SCORE_FIELD_VALUES = [
  "quality",
  "workload",
  "gpa",
  "rmp",
] as const;

export type FeedbackScoreField = (typeof FEEDBACK_SCORE_FIELD_VALUES)[number];

export type FeedbackSubmitDto = {
  kind: FeedbackKind;
  issue: FeedbackIssue;
  page: FeedbackPage;
  query?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  crn?: string;
  instructorName?: string;
  scoreField?: FeedbackScoreField;
  expected?: string;
  message?: string;
  anonymousSessionId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type FeedbackResponseDto = {
  id: string;
  status: "accepted";
  received_at: number;
};

export type FeedbackSubmitDecodeResult =
  | { ok: true; value: FeedbackSubmitDto }
  | { ok: false; error: string };

const MAX_QUERY_LENGTH = 500;
const MAX_EXPECTED_LENGTH = 1000;
const MAX_MESSAGE_LENGTH = 2000;

export function decodeFeedbackSubmitDto(
  value: unknown,
  options: { currentYear?: number } = {},
): FeedbackSubmitDecodeResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "feedback body must be an object" };
  }

  const body = value as Partial<FeedbackSubmitDto>;
  if (!includesFeedbackValue(FEEDBACK_KIND_VALUES, body.kind)) {
    return { ok: false, error: "kind is not supported" };
  }

  if (!includesFeedbackValue(FEEDBACK_ISSUE_VALUES, body.issue)) {
    return { ok: false, error: "issue is not supported" };
  }

  if (!includesFeedbackValue(FEEDBACK_PAGE_VALUES, body.page)) {
    return { ok: false, error: "page must be search or course" };
  }

  if (body.scoreField !== undefined && !includesFeedbackValue(FEEDBACK_SCORE_FIELD_VALUES, body.scoreField)) {
    return { ok: false, error: "scoreField is not supported" };
  }

  const stringError =
    validateOptionalString(body.query, "query", MAX_QUERY_LENGTH)
    ?? validateOptionalString(body.expected, "expected", MAX_EXPECTED_LENGTH)
    ?? validateOptionalString(body.message, "message", MAX_MESSAGE_LENGTH);
  if (stringError) return { ok: false, error: stringError };

  const maxYear = (options.currentYear ?? new Date().getFullYear()) + 2;
  if (
    body.year !== undefined
    && (!Number.isInteger(body.year) || body.year < 2004 || body.year > maxYear)
  ) {
    return { ok: false, error: "year is outside the supported range" };
  }

  if (body.metadata !== undefined && !isFeedbackMetadata(body.metadata)) {
    return { ok: false, error: "metadata must be a simple object" };
  }

  return {
    ok: true,
    value: body as FeedbackSubmitDto,
  };
}

function validateOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return `${field} must be a string`;
  if (value.length > maxLength) return `${field} must be at most ${maxLength} characters`;
  return null;
}

function isFeedbackMetadata(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) =>
      item === null
      || typeof item === "string"
      || typeof item === "number"
      || typeof item === "boolean",
  );
}

function includesFeedbackValue<const Values extends readonly unknown[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.includes(value as Values[number]);
}
