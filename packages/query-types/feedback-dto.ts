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
  "instructor_difficulty",
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

export const FEEDBACK_BODY_MAX_BYTES = 16 * 1024;
export const FEEDBACK_QUERY_MAX_LENGTH = 500;
export const FEEDBACK_EXPECTED_MAX_LENGTH = 1000;
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;
export const FEEDBACK_METADATA_MAX_ENTRIES = 20;
export const FEEDBACK_METADATA_MAX_KEY_LENGTH = 64;
export const FEEDBACK_METADATA_STRING_MAX_LENGTH = 500;
export const FEEDBACK_METADATA_MAX_SERIALIZED_LENGTH = 4096;

const FEEDBACK_SUBMIT_FIELDS = new Set<keyof FeedbackSubmitDto>([
  "kind",
  "issue",
  "page",
  "query",
  "courseId",
  "subject",
  "number",
  "term",
  "year",
  "crn",
  "instructorName",
  "scoreField",
  "expected",
  "message",
  "anonymousSessionId",
  "metadata",
]);

const OPTIONAL_STRING_LIMITS = {
  query: FEEDBACK_QUERY_MAX_LENGTH,
  courseId: 200,
  subject: 20,
  number: 20,
  term: 20,
  crn: 20,
  instructorName: 200,
  expected: FEEDBACK_EXPECTED_MAX_LENGTH,
  message: FEEDBACK_MESSAGE_MAX_LENGTH,
  anonymousSessionId: 200,
} as const satisfies Partial<Record<keyof FeedbackSubmitDto, number>>;

export function decodeFeedbackSubmitDto(
  value: unknown,
  options: { currentYear?: number } = {},
): FeedbackSubmitDecodeResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "feedback body must be an object" };
  }

  const body = value as Partial<FeedbackSubmitDto>;
  const unsupportedField = Object.keys(body).find(
    (field) => !FEEDBACK_SUBMIT_FIELDS.has(field as keyof FeedbackSubmitDto),
  );
  if (unsupportedField) {
    return {
      ok: false,
      error: `feedback body contains unsupported field: ${unsupportedField}`,
    };
  }

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

  for (const [field, maxLength] of Object.entries(OPTIONAL_STRING_LIMITS)) {
    const stringError = validateOptionalString(
      body[field as keyof typeof OPTIONAL_STRING_LIMITS],
      field,
      maxLength,
    );
    if (stringError) return { ok: false, error: stringError };
  }

  const maxYear = (options.currentYear ?? new Date().getFullYear()) + 2;
  if (
    body.year !== undefined
    && (!Number.isInteger(body.year) || body.year < 2004 || body.year > maxYear)
  ) {
    return { ok: false, error: "year is outside the supported range" };
  }

  if (body.metadata !== undefined) {
    const metadataError = validateFeedbackMetadata(body.metadata);
    if (metadataError) {
      return { ok: false, error: metadataError };
    }
  }

  if (!body.expected?.trim() && !body.message?.trim()) {
    return {
      ok: false,
      error: "expected or message must contain feedback",
    };
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

function validateFeedbackMetadata(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "metadata must be a simple object";
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > FEEDBACK_METADATA_MAX_ENTRIES) {
    return `metadata must contain at most ${FEEDBACK_METADATA_MAX_ENTRIES} entries`;
  }

  for (const [key, item] of entries) {
    if (!key || key.length > FEEDBACK_METADATA_MAX_KEY_LENGTH) {
      return `metadata keys must be 1-${FEEDBACK_METADATA_MAX_KEY_LENGTH} characters`;
    }
    if (
      item !== null
      && typeof item !== "string"
      && typeof item !== "number"
      && typeof item !== "boolean"
    ) {
      return "metadata values must be strings, finite numbers, booleans, or null";
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      return "metadata values must be strings, finite numbers, booleans, or null";
    }
    if (
      typeof item === "string"
      && item.length > FEEDBACK_METADATA_STRING_MAX_LENGTH
    ) {
      return `metadata string values must be at most ${FEEDBACK_METADATA_STRING_MAX_LENGTH} characters`;
    }
  }

  if (
    JSON.stringify(value).length
    > FEEDBACK_METADATA_MAX_SERIALIZED_LENGTH
  ) {
    return `metadata must serialize to at most ${FEEDBACK_METADATA_MAX_SERIALIZED_LENGTH} characters`;
  }

  return null;
}

function includesFeedbackValue<const Values extends readonly unknown[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.includes(value as Values[number]);
}
