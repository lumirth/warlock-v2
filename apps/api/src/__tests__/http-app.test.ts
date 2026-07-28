import { describe, expect, it } from "vitest";
import { isAllowedFeedbackOrigin } from "../http-app.js";

describe("feedback origin policy", () => {
  it("allows only exact configured origins", () => {
    const configured =
      "https://uiuc-course-search-web.pages.dev, https://staging.uiuc-course-search-web.pages.dev";

    expect(isAllowedFeedbackOrigin(
      "https://staging.uiuc-course-search-web.pages.dev",
      configured,
    )).toBe(true);
    expect(isAllowedFeedbackOrigin(
      "https://staging.uiuc-course-search-web.pages.dev.evil.example",
      configured,
    )).toBe(false);
    expect(isAllowedFeedbackOrigin(undefined, configured)).toBe(false);
    expect(isAllowedFeedbackOrigin("null", configured)).toBe(false);
  });
});
