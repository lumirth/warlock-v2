import type {
  Ambiguity,
  SearchFilters,
  SearchPlan,
  SearchPlanRescue,
  SearchSoftPreferences,
} from './search-planner-types.js';

export function cloneSearchPlan(plan: SearchPlan): SearchPlan {
  return {
    ...plan,
    filters: cloneSearchFilters(plan.filters),
    softPreferences: cloneSoftPreferences(plan.softPreferences),
    intents: plan.intents ? [...plan.intents] : undefined,
    ambiguities: plan.ambiguities?.map(cloneAmbiguity),
    rescue: cloneRescue(plan.rescue),
  };
}

export function withSearchPlanUpdates(
  plan: SearchPlan,
  update: (draft: SearchPlan) => void,
): SearchPlan {
  const draft = cloneSearchPlan(plan);
  update(draft);
  return draft;
}

function cloneSearchFilters(filters: SearchFilters): SearchFilters {
  const clone: SearchFilters = { ...filters };
  if (filters.instructor_ids) clone.instructor_ids = [...filters.instructor_ids];
  if (filters.requirement) {
    clone.requirement = {
      mode: filters.requirement.mode,
      codes: [...filters.requirement.codes],
    };
  }
  if (filters.not) {
    const not: NonNullable<SearchFilters['not']> = {};
    if (filters.not.time) not.time = [...filters.not.time];
    if (filters.not.days) not.days = [...filters.not.days];
    if (filters.not.instructor_ids) not.instructor_ids = [...filters.not.instructor_ids];
    if (filters.not.subjects) not.subjects = [...filters.not.subjects];
    if (filters.not.geneds) not.geneds = [...filters.not.geneds];
    if (filters.not.keywords) not.keywords = [...filters.not.keywords];
    clone.not = not;
  }
  return clone;
}

function cloneSoftPreferences(preferences: SearchSoftPreferences | undefined): SearchSoftPreferences | undefined {
  if (!preferences) return undefined;

  const clone: SearchSoftPreferences = { ...preferences };
  if (preferences.topicExpansions) clone.topicExpansions = [...preferences.topicExpansions];
  if (preferences.inferredSort) clone.inferredSort = { ...preferences.inferredSort };
  return clone;
}

function cloneAmbiguity(ambiguity: Ambiguity): Ambiguity {
  return {
    ...ambiguity,
    chosen: { ...ambiguity.chosen },
    alternatives: ambiguity.alternatives.map(alternative => ({ ...alternative })),
  };
}

function cloneRescue(rescue: SearchPlanRescue | undefined): SearchPlanRescue | undefined {
  return rescue
    ? {
      ...rescue,
      queryTypes: [...rescue.queryTypes],
      negativeTerms: [...rescue.negativeTerms],
      topicTerms: [...rescue.topicTerms],
      expandedTerms: [...rescue.expandedTerms],
      assumptions: rescue.assumptions.map(assumption => ({ ...assumption })),
      warnings: rescue.warnings.map(warning => ({ ...warning })),
      interpretedLanes: [...rescue.interpretedLanes],
      relaxationPlan: rescue.relaxationPlan.map(step => ({
        ...step,
        relaxes: [...step.relaxes],
        keeps: [...step.keeps],
      })),
    }
    : undefined;
}
