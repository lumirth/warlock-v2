import {
  canonicalRequirementCode,
  normalizeRequirementCodes,
  type CourseRequirementDto,
} from '@uiuc-course-search/query-types';
import type { CourseGened } from '../db/types.js';
import type { CourseSnapshot } from './course.js';

export type CourseRequirementSourceRow = Pick<
  CourseGened,
  'category_id' | 'category_name' | 'attribute_code' | 'attribute_name'
>;

type CourseRequirementEvidence = {
  requirements: CourseRequirementDto[];
  codes: string[];
  labels: string[];
  summaryCode: string | null;
};

export function courseSnapshotRequirementEvidence(snapshot: CourseSnapshot): CourseRequirementEvidence {
  const requirements = courseRequirementRowsToDto(
    snapshot.genEdCategories.map(category => ({
      category_id: category.categoryId,
      category_name: category.categoryName,
      attribute_code: category.attributeCode,
      attribute_name: category.attributeName,
    })),
  );

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

export function courseRequirementRowsToDto(
  rows: readonly CourseRequirementSourceRow[],
): CourseRequirementDto[] {
  return rows.map(courseRequirementRowToDto);
}

export function courseRequirementRowToDto(
  row: CourseRequirementSourceRow,
): CourseRequirementDto {
  return {
    categoryId: canonicalRequirementCode(row.category_id) ?? row.category_id,
    categoryName: row.category_name,
    attributeCode: canonicalRequirementCode(row.attribute_code),
    attributeName: row.attribute_name,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
