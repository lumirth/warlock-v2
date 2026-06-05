import type { SearchPlan } from "./search-planner-types.js";
import { sanitizeFtsQuery } from "./search-text.js";

export function buildAliasLaneQuery(plan: SearchPlan): string {
  const terms = new Set<string>();
  for (const value of [plan.keywordQuery, plan.semanticQuery]) {
    if (value?.trim()) terms.add(value.trim());
  }
  for (const value of plan.rescue?.topicTerms ?? []) terms.add(value);
  for (const value of plan.rescue?.expandedTerms ?? []) terms.add(value);
  for (const value of plan.rescue?.negativeTerms ?? []) {
    terms.add(value.replace(/_/g, " "));
  }
  for (const assumption of plan.rescue?.assumptions ?? []) {
    terms.add(assumption.kind.replace(/_/g, " "));
    terms.add(assumption.label);
  }

  const sanitizedTerms = Array.from(terms)
    .map(term => sanitizeFtsQuery(term))
    .filter(Boolean)
    .slice(0, 12);

  return sanitizedTerms.length > 0 ? sanitizedTerms.join(" OR ") : "";
}

export function workloadSignalTypes(plan: SearchPlan): string[] {
  const types = new Set<string>();
  const soft = plan.softPreferences ?? {};

  if (soft.lowWorkload || plan.filters.workload === "easy") {
    ["low_workload", "high_avg_gpa", "non_major_friendly"].forEach(type => types.add(type));
  }
  if (soft.lowWriting) {
    ["low_writing", "writing_light", "few_papers"].forEach(type => types.add(type));
  }
  if (soft.lowReading) {
    ["low_reading", "reading_light"].forEach(type => types.add(type));
  }
  if (soft.lowExams) {
    ["low_exams", "low_exam", "quiz_based"].forEach(type => types.add(type));
  }
  if (soft.lowMath) {
    ["low_math", "non_quantitative", "non_major_friendly"].forEach(type => types.add(type));
  }
  if (soft.noListedPrereq) {
    ["no_listed_prereq", "non_major_friendly"].forEach(type => types.add(type));
  }
  if (soft.fun) {
    types.add("interesting_topic");
  }

  return Array.from(types);
}
