import type { CourseGenedDto } from "@uiuc-course-search/query-types";
import { normalizeRequirementCodes } from "@uiuc-course-search/query-types";
import type { Course } from "../db/types.js";
import { canonicalGenedCode } from "./gened-codes.js";
import type { SearchResult } from "./search-types.js";

export function courseRequirementCodes(
  course: Pick<Course, "gened">,
  codes: readonly string[] | undefined = [],
): string[] {
  return normalizeCanonicalRequirementCodes([
    ...codes,
    course.gened ?? "",
  ]);
}

export function genedDtoRequirementCodes(geneds: readonly CourseGenedDto[] | undefined): string[] {
  return normalizeCanonicalRequirementCodes(
    (geneds ?? []).flatMap(gened => [
      gened.categoryId,
      gened.attributeCode ?? "",
    ]),
  );
}

export function searchResultRequirementCodes(
  result: SearchResult,
  geneds?: readonly CourseGenedDto[],
): string[] {
  return courseRequirementCodes(result.course, [
    ...genedDtoRequirementCodes(geneds),
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
      .map(code => canonicalGenedCode(code) ?? "")
      .filter(Boolean),
  );
}
