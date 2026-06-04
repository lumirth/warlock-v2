import type { SearchRecoveryGroup } from "@uiuc-course-search/query-types";
import type { SearchPlan } from "@uiuc-course-search/query-types/search-planner";

export function buildRecoveryGroups(
  plan: SearchPlan,
  rawQuery: string,
  resultCount: number,
): SearchRecoveryGroup[] | undefined {
  if (resultCount > 0 || !plan.rescue?.relaxationPlan.length) {
    return undefined;
  }

  const groups = plan.rescue.relaxationPlan
    .filter((step) => step.relaxes.length > 0)
    .slice(0, 4)
    .map(
      (step): SearchRecoveryGroup => ({
        id: step.id,
        label: step.label,
        description: describeRelaxation(step.relaxes),
        relaxes: step.relaxes,
        keeps: step.keeps,
        queryPatch: {
          replaceQuery: relaxedQuery(rawQuery, step.relaxes),
        },
      }),
    );

  return groups.length > 0 ? groups : undefined;
}

function describeRelaxation(relaxes: string[]): string {
  if (relaxes.includes("online")) {
    return "Keeps the requirement or topic intent while allowing in-person, hybrid, or unknown delivery.";
  }
  if (
    relaxes.some(
      (item) =>
        item.toLowerCase().includes("writing") ||
        item.toLowerCase().includes("exam") ||
        item.toLowerCase().includes("reading"),
    )
  ) {
    return "Keeps useful course matches and shows evidence warnings where assignment details are incomplete.";
  }
  if (relaxes.includes("specificRequirement")) {
    return "Keeps the topic and availability path while showing adjacent requirement buckets clearly labeled.";
  }
  return "Keeps the strongest interpreted intent while relaxing the least certain preference.";
}

function relaxedQuery(rawQuery: string, relaxes: string[]): string {
  let query = rawQuery;
  if (relaxes.includes("online")) {
    query = query.replace(/\b(?:online|remote|asynchronous|async)\b/gi, " ");
  }
  if (relaxes.some((item) => item.toLowerCase().includes("writing"))) {
    query = query.replace(
      /\b(?:no\s+)?(?:essays?|papers?|writing|writing-heavy|writing heavy)\b/gi,
      " ",
    );
  }
  if (relaxes.some((item) => item.toLowerCase().includes("exam"))) {
    query = query.replace(
      /\b(?:no\s+)?(?:exams?|tests?|midterms?|finals?)\b/gi,
      " ",
    );
  }
  return query.replace(/\s+/g, " ").trim() || rawQuery;
}
