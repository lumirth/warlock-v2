import { describe, expect, it } from "vitest";
import {
  normalizeSectionAvailability,
  rawSectionStatusesForSearchFilter,
} from "../section-availability-policy.js";

describe("normalizeSectionAvailability", () => {
  it("uses status codes when enrollment text is unavailable", () => {
    expect(normalizeSectionAvailability({
      status: "Unknown",
      statusCode: "A",
      sectionStatusCode: "A",
    })).toMatchObject({
      status: "open",
      label: "Open",
      rawStatus: "Unknown",
    });
  });

  it("recognizes repeated open codes without concatenating them", () => {
    expect(normalizeSectionAvailability({
      statusCode: "A",
      sectionStatusCode: "A",
    })).toMatchObject({
      status: "open",
      label: "Open",
    });
  });

  it("lets an explicit enrollment status outrank generic codes", () => {
    expect(normalizeSectionAvailability({
      status: "Closed",
      statusCode: "A",
      sectionStatusCode: "A",
    })).toMatchObject({
      status: "closed",
      label: "Closed",
    });
  });

  it("prefers the section-specific code when codes conflict", () => {
    expect(normalizeSectionAvailability({
      statusCode: "A",
      sectionStatusCode: "C",
    })).toMatchObject({
      status: "closed",
      label: "Closed",
    });
  });
});

describe("rawSectionStatusesForSearchFilter", () => {
  it("keeps restricted sections in the available filter", () => {
    expect(rawSectionStatusesForSearchFilter("available")).toEqual([
      "Open",
      "Restricted",
    ]);
  });
});
