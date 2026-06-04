import { describe, expect, it } from "vitest";
import {
  normalizeSearchRequest,
  searchPlanFiltersFromRequestFilters,
  searchPlanRequestCachePayload,
  searchRequestCachePayload,
} from "../search-request.js";

describe("search request normalization", () => {
  it("normalizes and freezes the canonical search request boundary", () => {
    const request = normalizeSearchRequest({
      query: "  Easy   Gen Ed  ",
      filters: {
        subject: "cs",
        instructor: "  Fagen  ",
        gened: "hum",
        days: "mwf",
        online: true,
      },
      sort: { field: "gpa", direction: "desc" },
      scope: "all",
    });

    expect(request).toEqual({
      query: "  Easy   Gen Ed  ",
      filters: {
        subject: "CS",
        instructor: "Fagen",
        gened: "HUM",
        days: "MWF",
        online: true,
      },
      sort: { field: "gpa", direction: "desc" },
      scope: "all",
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.filters)).toBe(true);
    expect(Object.isFrozen(request.sort)).toBe(true);
  });

  it("maps request filters to planner filters at the backend boundary", () => {
    const request = normalizeSearchRequest({
      query: "systems",
      filters: {
        subject: "CS",
        instructor: "Fagen",
        gened: "HUM",
        credits: 4,
        partOfTerm: "a",
      },
    });

    expect(searchPlanFiltersFromRequestFilters(request.filters)).toEqual({
      subject: "CS",
      requirement: { mode: "single", codes: ["HUM"] },
      credits: 4,
      partOfTerm: "A",
    });
  });

  it("builds stable plan and result cache payloads from the canonical request", () => {
    const left = normalizeSearchRequest({
      query: " Easy   Online Gen Ed ",
      filters: { credits: 3, online: true },
      sort: { field: "gpa", direction: "desc" },
      scope: "all",
    });
    const right = normalizeSearchRequest({
      query: "easy online gen ed",
      filters: { online: true, credits: 3 },
      sort: { field: "gpa", direction: "desc" },
      scope: "all",
    });

    expect(searchPlanRequestCachePayload(left)).toEqual(
      searchPlanRequestCachePayload(right),
    );
    expect(searchRequestCachePayload(left)).toEqual(
      searchRequestCachePayload(right),
    );
  });
});
