import type { CourseGenedDto } from '@uiuc-course-search/query-types';
import { normalizeRequirementCodes } from '@uiuc-course-search/query-types';
import type { CourseSnapshot } from './course.js';
import { canonicalGenedCode } from '../services/gened-codes.js';

export type CourseRequirementEvidence = {
  geneds: CourseGenedDto[];
  codes: string[];
  labels: string[];
  summaryCode: string | null;
};

export function courseSnapshotRequirementEvidence(snapshot: CourseSnapshot): CourseRequirementEvidence {
  const geneds = snapshot.genEdCategories.map(gened => ({
    categoryId: gened.categoryId,
    categoryName: gened.categoryName,
    attributeCode: canonicalGenedCode(gened.attributeCode),
    attributeName: gened.attributeName,
  }));

  const richCodes = normalizeRequirementCodes(
    snapshot.genEdCategories.flatMap(gened => [
      gened.categoryId,
      gened.attributeCode ?? '',
    ]).map(code => canonicalGenedCode(code) ?? '').filter(Boolean)
  );
  const codes = richCodes.length > 0
    ? richCodes
    : normalizeRequirementCodes([
      canonicalGenedCode(snapshot.course.gened) ?? '',
    ].filter(Boolean));
  const labels = uniqueStrings(snapshot.genEdCategories.flatMap(gened => [
    gened.categoryName,
    gened.attributeName,
  ]).filter((value): value is string => Boolean(value)));

  return {
    geneds,
    codes,
    labels,
    summaryCode: codes[0] ?? null,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
