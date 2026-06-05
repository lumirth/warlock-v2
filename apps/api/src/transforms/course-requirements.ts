import type { CourseRequirementDto } from '@uiuc-course-search/query-types';
import { normalizeRequirementCodes } from '@uiuc-course-search/query-types';
import type { CourseSnapshot } from './course.js';
import { canonicalRequirementCode } from '../services/requirement-codes.js';

export type CourseRequirementEvidence = {
  requirements: CourseRequirementDto[];
  codes: string[];
  labels: string[];
  summaryCode: string | null;
};

export function courseSnapshotRequirementEvidence(snapshot: CourseSnapshot): CourseRequirementEvidence {
  const requirements = snapshot.genEdCategories.map(category => ({
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    attributeCode: canonicalRequirementCode(category.attributeCode),
    attributeName: category.attributeName,
  }));

  const richCodes = normalizeRequirementCodes(
    snapshot.genEdCategories.flatMap(category => [
      category.categoryId,
      category.attributeCode ?? '',
    ]).map(code => canonicalRequirementCode(code) ?? '').filter(Boolean)
  );
  const codes = richCodes;
  const labels = uniqueStrings(snapshot.genEdCategories.flatMap(category => [
    category.categoryName,
    category.attributeName,
  ]).filter((value): value is string => Boolean(value)));

  return {
    requirements,
    codes,
    labels,
    summaryCode: codes[0] ?? null,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
