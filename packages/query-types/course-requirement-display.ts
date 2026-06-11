import type { CourseRequirementDto } from "./course-dto.js";
import {
  canonicalRequirementCode,
  GENED_REQUIREMENT_LABELS,
} from "./requirement-options.js";

export function courseRequirementLabel(requirement: CourseRequirementDto): string {
  const categoryCode = canonicalRequirementCode(requirement.categoryId);
  const attributeCode = canonicalRequirementCode(requirement.attributeCode);
  const category = labelForCode(categoryCode) ?? requirement.categoryName ?? categoryCode;
  const attribute = labelForCode(attributeCode) ?? requirement.attributeName ?? attributeCode;

  if (category && attribute && categoryCode !== attributeCode) {
    return `${category}: ${attribute}`;
  }
  return attribute ?? category ?? "Course requirement";
}

export function courseRequirementShortLabel(requirement: CourseRequirementDto): string {
  const categoryCode = canonicalRequirementCode(requirement.categoryId);
  const attributeCode = canonicalRequirementCode(requirement.attributeCode);

  if (categoryCode && attributeCode && categoryCode !== attributeCode) {
    return `${categoryCode}:${attributeCode}`;
  }
  return attributeCode ?? categoryCode ?? courseRequirementLabel(requirement);
}

function labelForCode(code: string | null): string | null {
  return code ? GENED_REQUIREMENT_LABELS[code] ?? null : null;
}
