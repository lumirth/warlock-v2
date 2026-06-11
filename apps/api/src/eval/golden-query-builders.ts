import {
  requirementFilter as buildRequirementFilter,
  singleRequirementFilter,
} from '@uiuc-course-search/query-types';

export function requirement(code: string) {
  const filter = singleRequirementFilter(code);
  if (!filter) throw new Error(`Invalid golden requirement code: ${code}`);
  return filter;
}

export function anyRequirement(codes: readonly string[]) {
  const filter = buildRequirementFilter("any", codes);
  if (!filter) throw new Error("Invalid golden any-requirement filter");
  return filter;
}

export function allRequirement(codes: readonly string[]) {
  const filter = buildRequirementFilter("all", codes);
  if (!filter) throw new Error("Invalid golden all-requirement filter");
  return filter;
}
