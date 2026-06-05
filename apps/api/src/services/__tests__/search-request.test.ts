import { describe, expect, it } from "vitest";
import { requirementFilter, singleRequirementFilter } from "@uiuc-course-search/query-types";
import {
  normalizeSearchRequest,
  searchPlanFiltersFromRequestFilters,
} from "../search-request.js";

describe("search request normalization", () => {
  it("normalizes and freezes the canonical search request boundary", () => {
    const request = normalizeSearchRequest({
      query: "  Easy   Gen Ed  ",
      filters: {
        subject: "cs",
        instructor: "  Fagen  ",
        requirement: singleRequirementFilter("hum"),
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
        requirement: { mode: "single", codes: ["HUM"] },
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
        requirement: requirementFilter("any", ["hum", "us"]),
        credits: 4,
        partOfTerm: "a",
      },
    });

    expect(searchPlanFiltersFromRequestFilters(request.filters)).toEqual({
      subject: "CS",
      requirement: { mode: "any", codes: ["HUM", "US"] },
      credits: 4,
      partOfTerm: "A",
    });
  });

});
