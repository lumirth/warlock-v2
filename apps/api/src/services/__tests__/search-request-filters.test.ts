import { describe, expect, it } from "vitest";
import {
  normalizeSearchRequestDto,
  requirementFilter,
  singleRequirementFilter,
} from "@uiuc-course-search/query-types";
import {
  resolveSearchRequestFilters,
} from "../search-request-filters.js";
import type { D1Database } from "@cloudflare/workers-types";

describe("search request normalization", () => {
  it("normalizes the canonical search request without mutating caller input", () => {
    const input = {
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
    } as const;
    const request = normalizeSearchRequestDto(input);

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
    expect(input.filters.subject).toBe("cs");
    expect(input.filters.instructor).toBe("  Fagen  ");
    expect(input.filters.requirement).toEqual({
      mode: "single",
      codes: ["HUM"],
    });
  });

  it("resolves request filters directly into planner filters", async () => {
    const request = normalizeSearchRequestDto({
      query: "systems",
      filters: {
        subject: "CS",
        instructor: "Fagen",
        requirement: requirementFilter("any", ["hum", "us"]),
        credits: 4,
        partOfTerm: "a",
      },
    });

    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ id: 3365 }] }),
        }),
      }),
    } as unknown as D1Database;

    await expect(resolveSearchRequestFilters(db, request.filters)).resolves.toEqual({
      subject: "CS",
      instructor_ids: [3365],
      requirement: { mode: "any", codes: ["HUM", "US"] },
      credits: 4,
      partOfTerm: "A",
    });
  });

  it("keeps an unresolved explicit instructor filter as an impossible hard constraint", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    await expect(resolveSearchRequestFilters(db, {
      instructor: "Nobody Here",
    })).resolves.toEqual({
      instructor_ids: [],
    });
  });
});
