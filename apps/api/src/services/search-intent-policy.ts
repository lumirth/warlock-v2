import type { SearchPlan } from "./search-planner-types.js";

export function parseBooleanFilterValue(value: string): boolean | undefined {
  const normalized = value.toLowerCase();
  if (["true", "yes", "1", "online", "remote"].includes(normalized)) {
    return true;
  }
  if (
    ["false", "no", "0", "in-person", "in_person", "inperson"].includes(
      normalized,
    )
  ) {
    return false;
  }
  return undefined;
}

export function applyStructuredNegation(
  field: string,
  value: string,
  plan: SearchPlan,
): void {
  const normalized = value.trim();
  if (!normalized) return;

  plan.filters.not = plan.filters.not || {};

  if (field === "subject") {
    plan.filters.not.subjects = plan.filters.not.subjects || [];
    plan.filters.not.subjects.push(normalized.toUpperCase());
    applyNegativeSoftPreference(normalized, plan);
    return;
  }

  if (field === "requirement") {
    plan.filters.not.requirementCodes = plan.filters.not.requirementCodes || [];
    plan.filters.not.requirementCodes.push(normalized.toUpperCase());
    return;
  }

  if (field === "keyword" || field === "workload") {
    plan.filters.not.keywords = plan.filters.not.keywords || [];
    plan.filters.not.keywords.push(normalized);
    applyNegativeSoftPreference(normalized, plan);
  }
}

function applyNegativeSoftPreference(value: string, plan: SearchPlan): void {
  const normalized = value.toLowerCase();
  const softPreferences = { ...(plan.softPreferences ?? {}) };

  if (/\b(math|calculus|stat|statistics|coding|programming|cs)\b/.test(normalized)) {
    softPreferences.lowMath = 0.84;
  }
  if (/\b(essay|paper|writing|writing heavy|writing-heavy)\b/.test(normalized)) {
    softPreferences.lowWriting = 0.84;
  }
  if (/\b(reading|reading heavy|reading-heavy)\b/.test(normalized)) {
    softPreferences.lowReading = 0.78;
  }
  if (/\b(exam|test|quiz|midterm|final)\b/.test(normalized)) {
    softPreferences.lowExams = 0.78;
  }

  plan.softPreferences = softPreferences;
}
