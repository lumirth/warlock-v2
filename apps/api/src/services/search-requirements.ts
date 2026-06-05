import type { CourseRequirementDto } from "@uiuc-course-search/query-types";
import { normalizeRequirementCodes } from "@uiuc-course-search/query-types";
import { canonicalRequirementCode } from "./requirement-codes.js";
import type { SearchResult } from "./search-types.js";

export function structuredRequirementCodes(
  codes: readonly string[] | undefined = [],
): string[] {
  return normalizeCanonicalRequirementCodes(codes);
}

export function courseRequirementDtoCodes(requirementCodes: readonly CourseRequirementDto[] | undefined): string[] {
  return normalizeCanonicalRequirementCodes(
    (requirementCodes ?? []).flatMap(requirement => [
      requirement.categoryId,
      requirement.attributeCode ?? "",
    ]),
  );
}

export function searchResultRequirementCodes(
  result: SearchResult,
  requirementCodes?: readonly CourseRequirementDto[],
): string[] {
  return structuredRequirementCodes([
    ...courseRequirementDtoCodes(requirementCodes),
    ...(result.requirementCodes ?? []),
  ]);
}

export function matchingRequirementCodes(
  availableCodes: readonly string[],
  requestedCodes: readonly string[],
): string[] {
  const available = normalizeCanonicalRequirementCodes(availableCodes);
  const requested = normalizeCanonicalRequirementCodes(requestedCodes);
  const requestedSet = new Set(requested);
  return available.filter(code => requestedSet.has(code));
}

function normalizeCanonicalRequirementCodes(codes: readonly string[]): string[] {
  return normalizeRequirementCodes(
    codes
      .map(code => canonicalRequirementCode(code) ?? "")
      .filter(Boolean),
  );
}
