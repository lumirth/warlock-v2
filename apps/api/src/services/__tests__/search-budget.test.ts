import { describe, expect, it } from "vitest";
import {
  MAX_BROWSEABLE_SEARCH_RESULTS,
  MAX_SEMANTIC_LANE_RESULTS,
  buildSearchCandidateBudget,
} from "../search-budget.js";

describe("buildSearchCandidateBudget", () => {
  it("keeps one stable browse window for every page", () => {
    const firstRequest = buildSearchCandidateBudget();
    const laterRequest = buildSearchCandidateBudget();

    expect(firstRequest.browseableResultLimit).toBe(
      MAX_BROWSEABLE_SEARCH_RESULTS,
    );
    expect(laterRequest.browseableResultLimit).toBe(
      firstRequest.browseableResultLimit,
    );
    expect(laterRequest.semanticLaneResultLimit).toBe(
      firstRequest.semanticLaneResultLimit,
    );
  });

  it("keeps semantic recall within the Vectorize top-k limit", () => {
    const budget = buildSearchCandidateBudget();

    expect(budget.semanticLaneResultLimit).toBe(MAX_SEMANTIC_LANE_RESULTS);
  });

  it("supports a smaller explicitly bounded browse window", () => {
    const budget = buildSearchCandidateBudget(60);

    expect(budget).toEqual({
      browseableResultLimit: 60,
      semanticLaneResultLimit: 60,
    });
  });
});
