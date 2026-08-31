const PAGES = ["search", "course"] as const;
export type FeedbackPage = (typeof PAGES)[number];

export type FeedbackSubmitDto = {
  page: FeedbackPage;
  query?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  expected?: string;
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
};
export type FeedbackResponseDto = { id: string; status: "accepted"; received_at: number };
export const FEEDBACK_BODY_MAX_BYTES = 16 * 1024;
export const FEEDBACK_EXPECTED_MAX_LENGTH = 1000;
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;
export const FEEDBACK_METADATA_MAX_ENTRIES = 20;

const STRING_LIMITS = {
  query: 500,
  courseId: 200,
  subject: 20,
  number: 20,
  term: 20,
  expected: FEEDBACK_EXPECTED_MAX_LENGTH,
  message: FEEDBACK_MESSAGE_MAX_LENGTH,
} as const;
const FIELDS = new Set(["page", ...Object.keys(STRING_LIMITS), "year", "metadata"]);

export function decodeFeedbackSubmitDto(
  value: unknown,
  options: { currentYear?: number } = {},
): { ok: true; value: FeedbackSubmitDto } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "feedback body must be an object" };
  }
  const body = value as Record<string, unknown>;
  const error = feedbackError(body, options.currentYear ?? new Date().getFullYear());
  return error ? { ok: false, error } : { ok: true, value: body as FeedbackSubmitDto };
}

function feedbackError(body: Record<string, unknown>, currentYear: number): string | null {
  const unknown = Object.keys(body).find(field => !FIELDS.has(field));
  if (unknown) return `feedback body contains unsupported field: ${unknown}`;
  if (!PAGES.includes(body.page as FeedbackPage)) return "page must be search or course";
  const strings = stringFieldsError(body);
  if (strings) return strings;
  if (!validYear(body.year, currentYear)) return "year is outside the supported range";
  if (body.metadata !== undefined) {
    const error = metadataError(body.metadata);
    if (error) return error;
  }
  return hasText(body.expected) || hasText(body.message)
    ? null : "expected or message must contain feedback";
}

function stringFieldsError(body: Record<string, unknown>): string | null {
  for (const [field, limit] of Object.entries(STRING_LIMITS)) {
    const item = body[field];
    if (item === undefined) continue;
    if (typeof item !== "string") return `${field} must be a string`;
    if (item.length > limit) return `${field} must be at most ${limit} characters`;
  }
  return null;
}

function validYear(value: unknown, currentYear: number): boolean {
  return value === undefined || (Number.isInteger(value)
    && (value as number) >= 2004 && (value as number) <= currentYear + 2);
}

function metadataError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "metadata must be a simple object";
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > FEEDBACK_METADATA_MAX_ENTRIES) {
    return `metadata must contain at most ${FEEDBACK_METADATA_MAX_ENTRIES} entries`;
  }
  for (const [key, item] of entries) {
    const error = metadataEntryError(key, item);
    if (error) return error;
  }
  return JSON.stringify(value).length > 4096
    ? "metadata must serialize to at most 4096 characters" : null;
}

function metadataEntryError(key: string, value: unknown): string | null {
  if (!key || key.length > 64) return "metadata keys must be 1-64 characters";
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? null : "metadata values must be primitive JSON values";
  }
  if (typeof value === "string") {
    return value.length <= 500 ? null : "metadata string values must be at most 500 characters";
  }
  return "metadata values must be primitive JSON values";
}

const hasText = (value: unknown) => typeof value === "string" && Boolean(value.trim());
