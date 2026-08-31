import { describe, expect, it } from "vitest";
import {
  buildCourseExplorerCourseUrl,
  buildRmpProfessorUrl,
  canonicalRequirementCode,
  courseRequirementLabel,
  decodeFeedbackSubmitDto,
  decodeSearchRequestQuery,
  FEEDBACK_METADATA_MAX_ENTRIES,
  formatGenEdDisplayLabel,
  getInstructorDifficultyTierLabel,
  getQualityTierLabel,
  isKnownRequirementCode,
  normalizeSearchRequestDto,
  requirementFilter,
  searchRequestToQueryEntries,
} from "./index.js";

const reader = (entries: Array<[string, string]>) => ({
  get: (name: string) => entries.find(([key]) => key === name)?.[1] ?? null,
});

describe("course policy", () => {
  it("owns canonical requirements and public labels", () => {
    expect(requirementFilter("any", [" hum ", "HUM", "1us", "cmp"])).toEqual({
      mode: "any",
      codes: ["HUM", "US", "COMP1"],
    });
    expect(canonicalRequirementCode("1NW")).toBe("NW");
    expect(isKnownRequirementCode("ZZ")).toBe(false);
    expect(formatGenEdDisplayLabel(["1US", "HUM"])).toBe("GenEd US, HUM");
    expect(courseRequirementLabel({
      categoryId: "CS",
      categoryName: null,
      attributeCode: "1US",
      attributeName: null,
    })).toBe("Cultural Studies: US Minority Cultures");
  });

  it("keeps score labels and trusted outbound links stable", () => {
    expect([getQualityTierLabel(85), getQualityTierLabel(70), getQualityTierLabel(50), getQualityTierLabel(0)])
      .toEqual(["Excellent", "Good", "Fair", "Low"]);
    expect([getInstructorDifficultyTierLabel(45), getInstructorDifficultyTierLabel(46), getInstructorDifficultyTierLabel(76)])
      .toEqual(["Lower", "Moderate", "Higher"]);
    expect(buildCourseExplorerCourseUrl({ year: 2026, term: "Spring", subject: "cs", number: "374" }))
      .toBe("https://courses.illinois.edu/schedule/2026/spring/CS/374");
    expect(buildRmpProfessorUrl("85515")).toBe("https://www.ratemyprofessors.com/professor/85515");
    expect(buildRmpProfessorUrl("opaque-id")).toBeNull();
  });
});

describe("search boundary", () => {
  it("round-trips the canonical request", () => {
    const entries = searchRequestToQueryEntries({
      query: "online stats class",
      filters: {
        subject: " stat ",
        requirement: requirementFilter("any", ["hum", "us"]),
        online: true,
        instructorDifficulty: "lower",
      },
      sort: { field: "gpa", direction: "desc" },
      scope: "all",
      pagination: { limit: 25, offset: 50 },
    });
    expect(decodeSearchRequestQuery(reader(entries))).toEqual({
      ok: true,
      value: {
        request: {
          query: "online stats class",
          filters: {
            subject: "STAT",
            requirement: { mode: "any", codes: ["HUM", "US"] },
            online: true,
            instructorDifficulty: "lower",
          },
          sort: { field: "gpa", direction: "desc" },
          scope: "all",
        },
        pagination: { limit: 25, offset: 50 },
      },
    });
  });

  it("rejects malformed filters, controls, and empty requests", () => {
    expect(() => normalizeSearchRequestDto({ query: "x", filters: { level: 700 as never } }))
      .toThrow("level must be one of");
    expect(decodeSearchRequestQuery(reader([["q", "history"], ["sort", "bogus"]])))
      .toEqual({ ok: false, error: "sort field must be one of: relevance, gpa, quality, instructor_difficulty, instructor_rating, level, credits" });
    expect(decodeSearchRequestQuery(reader([["q", "x"], ["online", "1"]])))
      .toEqual({ ok: false, error: "online must be a boolean" });
    expect(decodeSearchRequestQuery(reader([])))
      .toEqual({ ok: false, error: "Missing query parameter q" });
  });
});

describe("feedback boundary", () => {
  const valid = {
    page: "search",
    expected: "More relevant results",
  } as const;

  it("accepts the bounded public shape", () => {
    expect(decodeFeedbackSubmitDto({ ...valid, metadata: { rank: 3, selected: true } })).toEqual({
      ok: true,
      value: { ...valid, metadata: { rank: 3, selected: true } },
    });
  });

  it("rejects unsupported, empty, and unbounded input", () => {
    expect(decodeFeedbackSubmitDto({ ...valid, extra: true })).toEqual({
      ok: false,
      error: "feedback body contains unsupported field: extra",
    });
    expect(decodeFeedbackSubmitDto({ ...valid, expected: " " })).toEqual({
      ok: false,
      error: "expected or message must contain feedback",
    });
    expect(decodeFeedbackSubmitDto({
      ...valid,
      metadata: Object.fromEntries(Array.from({ length: FEEDBACK_METADATA_MAX_ENTRIES + 1 }, (_, i) => [String(i), i])),
    })).toEqual({
      ok: false,
      error: `metadata must contain at most ${FEEDBACK_METADATA_MAX_ENTRIES} entries`,
    });
  });
});
