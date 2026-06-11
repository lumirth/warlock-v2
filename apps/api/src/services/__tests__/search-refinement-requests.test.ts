import { describe, expect, it } from "vitest";
import {
  normalizeSearchRequestDto,
  singleRequirementFilter,
} from "@uiuc-course-search/query-types";
import { removeSearchIntentRequest } from "../search-refinement-requests.js";

describe("removeSearchIntentRequest", () => {
  it("removes inferred intent as a whole phrase instead of corrupting words", () => {
    const request = normalizeSearchRequestDto({ query: "history IS classes" });

    expect(removeSearchIntentRequest(request, {
      kind: "filter_or_query_phrase",
      filter: { subject: "IS" },
      phrase: "IS",
    })).toEqual({
      query: "history classes",
      sort: { field: "relevance", direction: "desc" },
      scope: "active",
    });
  });

  it("does not mistake a requirement code inside another word for the selected intent", () => {
    const request = normalizeSearchRequestDto({ query: "business US gen ed" });

    expect(removeSearchIntentRequest(request, {
      kind: "filter_or_query_phrase",
      filter: { requirement: singleRequirementFilter("US") },
      phrase: "US",
    })).toEqual({
      query: "business",
      sort: { field: "relevance", direction: "desc" },
      scope: "active",
    });
  });

  it("removes exact structured filters without rewriting query text", () => {
    const request = normalizeSearchRequestDto({
      query: "systems",
      filters: { subject: "CS", online: true },
    });

    expect(removeSearchIntentRequest(request, {
      kind: "filter",
      filter: { online: true },
    })).toEqual({
      query: "systems",
      filters: { subject: "CS" },
      sort: { field: "relevance", direction: "desc" },
      scope: "active",
    });
  });

  it("rejects malformed no-op removal actions instead of publishing them", () => {
    const request = normalizeSearchRequestDto({ query: "algorithms" });

    expect(() => removeSearchIntentRequest(request, {
      kind: "filter",
      filter: { subject: "CS" },
    })).toThrow("Cannot remove a search filter that is not present");
    expect(() => removeSearchIntentRequest(request, {
      kind: "query_phrase",
      phrase: "databases",
    })).toThrow("Cannot remove missing search text: databases");
  });

  it("removes normalized residual terms even when extracted filters split them", () => {
    const request = normalizeSearchRequestDto({ query: "data online structures" });

    expect(removeSearchIntentRequest(request, {
      kind: "query_terms",
      terms: "data structures",
    })).toEqual({
      query: "online",
      sort: { field: "relevance", direction: "desc" },
      scope: "active",
    });
  });
});
