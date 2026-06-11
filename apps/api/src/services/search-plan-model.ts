import type { SearchPlan } from './search-planner-types.js';

function cloneSearchPlan(plan: SearchPlan): SearchPlan {
  return structuredClone(plan);
}

export function withSearchPlanUpdates(
  plan: SearchPlan,
  update: (draft: SearchPlan) => void,
): SearchPlan {
  const draft = cloneSearchPlan(plan);
  update(draft);
  return draft;
}
