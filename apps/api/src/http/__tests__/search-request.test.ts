import { describe, expect, it } from "vitest";
import { parseSearchHttpRequest } from "../search-request.js";

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
        gened: "hum",
        credits: "4",
        days: "mwf",
        time: "morning",
        part_of_term: "a",
        online: "yes",
        status: "open",
        difficulty: "easy",
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
            gened: "HUM",
            credits: 4,
            days: "MWF",
            time: "morning",
            partOfTerm: "A",
            online: true,
            status: "open",
            difficulty: "easy",
            level: 400,
          },
          sort: { field: "gpa", direction: "asc" },
          scope: "all",
        },
        pagination: { limit: 25, offset: 50 },
      },
    });
  });

  it("falls back for invalid sort, scope, and level without rejecting the search", () => {
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
      ok: true,
      value: {
        request: {
          query: "history",
          filters: {},
          sort: { field: "relevance", direction: "desc" },
          scope: "active",
        },
        pagination: { limit: 20, offset: 0 },
      },
    });
  });

  it("rejects missing query requests that do not include structured filters", () => {
    expect(parseSearchHttpRequest(new URLSearchParams())).toEqual({
      ok: false,
      error: "Missing query parameter q",
    });
  });
});
