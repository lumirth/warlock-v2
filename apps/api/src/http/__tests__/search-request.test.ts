import { describe, expect, it } from "vitest";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import { parseSearchHttpRequest } from "../search-request.js";
import { SEARCH_QUERY_MAX_LENGTH } from "@uiuc-course-search/query-types";

describe("parseSearchHttpRequest", () => {
  it("normalizes public search params into a canonical request and pagination", () => {
    const parsed = parseSearchHttpRequest(
      new URLSearchParams({
        q: "systems",
        subject: "cs",
        number: "225",
        instructor: "  Fagen  ",
        term: "spring",
        year: "2026",
        requirement: "hum",
        credits: "4",
        days: "mwf",
        time: "morning",
        part_of_term: "a",
        online: "yes",
        status: "open",
        instructor_difficulty: "lower",
        level: "400",
        sort: "gpa",
        direction: "asc",
        scope: "all",
        limit: "25",
        offset: "50",
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        request: {
          query: "systems",
          filters: {
            subject: "CS",
            number: "225",
            instructor: "Fagen",
            term: "spring",
            year: 2026,
            requirement: singleRequirementFilter("HUM"),
            credits: 4,
            days: "MWF",
            time: "morning",
            partOfTerm: "A",
            online: true,
            status: "open",
            instructorDifficulty: "lower",
            level: 400,
          },
          sort: { field: "gpa", direction: "asc" },
          scope: "all",
        },
        pagination: { limit: 25, offset: 50 },
      },
    });
  });

  it("rejects invalid explicit controls instead of silently reinterpreting them", () => {
    const parsed = parseSearchHttpRequest(
      new URLSearchParams({
        q: "history",
        sort: "weird",
        direction: "sideways",
        scope: "forever",
        level: "100abc",
      }),
    );

    expect(parsed).toEqual({
      ok: false,
      error: "sort must be one of: relevance, gpa, quality, instructor_difficulty, instructor_rating, level, credits",
    });
  });

  it("rejects missing query requests that do not include structured filters", () => {
    expect(parseSearchHttpRequest(new URLSearchParams())).toEqual({
      ok: false,
      error: "Missing query parameter q",
    });
  });

  it("rejects overlong query text at the HTTP boundary", () => {
    expect(parseSearchHttpRequest(new URLSearchParams({
      q: "x".repeat(SEARCH_QUERY_MAX_LENGTH + 1),
    }))).toEqual({
      ok: false,
      error: `q must be ${SEARCH_QUERY_MAX_LENGTH} characters or fewer`,
    });
  });
});
