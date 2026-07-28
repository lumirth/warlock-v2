import { describe, expect, it } from "vitest";
import {
  decodeFeedbackSubmitDto,
  FEEDBACK_METADATA_MAX_ENTRIES,
  FEEDBACK_METADATA_MAX_SERIALIZED_LENGTH,
} from "./feedback-dto.js";

const validFeedback = {
  kind: "search_results",
  issue: "expected_different_results",
  page: "search",
  expected: "More relevant results",
} as const;

describe("decodeFeedbackSubmitDto", () => {
  it("accepts bounded simple metadata", () => {
    expect(decodeFeedbackSubmitDto({
      ...validFeedback,
      metadata: {
        source: "results",
        selected: true,
        rank: 3,
        prior: null,
      },
    })).toEqual({
      ok: true,
      value: {
        ...validFeedback,
        metadata: {
          source: "results",
          selected: true,
          rank: 3,
          prior: null,
        },
      },
    });
  });

  it("rejects unbounded or non-finite metadata", () => {
    expect(decodeFeedbackSubmitDto({
      ...validFeedback,
      metadata: Object.fromEntries(
        Array.from(
          { length: FEEDBACK_METADATA_MAX_ENTRIES + 1 },
          (_, index) => [`key-${index}`, index],
        ),
      ),
    })).toEqual({
      ok: false,
      error: `metadata must contain at most ${FEEDBACK_METADATA_MAX_ENTRIES} entries`,
    });

    expect(decodeFeedbackSubmitDto({
      ...validFeedback,
      metadata: { score: Number.POSITIVE_INFINITY },
    })).toEqual({
      ok: false,
      error: "metadata values must be strings, finite numbers, booleans, or null",
    });

    expect(decodeFeedbackSubmitDto({
      ...validFeedback,
      metadata: Object.fromEntries(
        Array.from(
          { length: FEEDBACK_METADATA_MAX_ENTRIES },
          (_, index) => [`payload-${index}`, "x".repeat(210)],
        ),
      ),
    })).toEqual({
      ok: false,
      error: `metadata must serialize to at most ${FEEDBACK_METADATA_MAX_SERIALIZED_LENGTH} characters`,
    });
  });

  it("rejects unknown top-level fields and overlong context strings", () => {
    expect(decodeFeedbackSubmitDto({
      ...validFeedback,
      unexpected: true,
    })).toEqual({
      ok: false,
      error: "feedback body contains unsupported field: unexpected",
    });

    expect(decodeFeedbackSubmitDto({
      ...validFeedback,
      courseId: "x".repeat(201),
    })).toEqual({
      ok: false,
      error: "courseId must be at most 200 characters",
    });
  });

  it("rejects empty-content feedback", () => {
    expect(decodeFeedbackSubmitDto({
      kind: "search_results",
      issue: "expected_different_results",
      page: "search",
      expected: "   ",
      message: "\n",
    })).toEqual({
      ok: false,
      error: "expected or message must contain feedback",
    });
  });
});
