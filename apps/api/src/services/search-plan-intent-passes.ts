import type { SearchSort } from '@uiuc-course-search/query-types';
import type { SearchPlan } from './search-planner-types.js';
import { withSearchPlanUpdates } from './search-plan-model.js';
import { sanitizeFtsQuery } from './search-text.js';
import { expandTopics } from './topic-registry.js';
import { appendQueryText } from './search-plan-query-language.js';

function removeIntroductoryScaffolding(query: string): string {
  return query
    .replace(/\b(intro|introductory|beginner)\b/gi, ' ')
    .replace(/\b(to|for|in|into|courses?|classes?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  const levelBoost = plan.softPreferences?.levelBoost;
  if (
    levelBoost !== 100 ||
    plan.filters.level !== undefined ||
    !plan.filters.subject
  ) {
    return false;
  }

  const remainingTopic = removeIntroductoryScaffolding(plan.semanticQuery);
  if (remainingTopic.length > 0) {
    return false;
  }

  const intents = new Set(plan.intents ?? []);
  intents.add('introductory_gateway');
  plan.intents = Array.from(intents);
  plan.softPreferences = {
    ...plan.softPreferences,
    introductoryIntent: 'gateway',
  };
  plan.semanticQuery = '';
  plan.keywordQuery = '';
  return true;
}

export type IntroductoryGatewayResult = {
  plan: SearchPlan;
  applied: boolean;
};

export function compileIntroductoryGatewayIntent(plan: SearchPlan): IntroductoryGatewayResult {
  let applied = false;
  const nextPlan = withSearchPlanUpdates(plan, draft => {
    applied = applyIntroductoryGatewayIntent(draft);
  });

  return { plan: applied ? nextPlan : plan, applied };
}

function applyTopicExpansion(plan: SearchPlan): string[] {
  const sourceQuery = plan.semanticQuery || plan.keywordQuery || '';
  const expansions = expandTopics(sourceQuery);
  if (expansions.length === 0) {
    return [];
  }

  plan.softPreferences = {
    ...plan.softPreferences,
    topicExpansions: expansions,
  };
  plan.semanticQuery = appendQueryText(
    plan.semanticQuery,
    expansions.join(' '),
  );
  plan.keywordQuery = buildTopicExpansionKeywordQuery(plan.keywordQuery, expansions);
  return expansions;
}

export type TopicExpansionResult = {
  plan: SearchPlan;
  expansions: string[];
};

export function compileTopicExpansion(plan: SearchPlan): TopicExpansionResult {
  let expansions: string[] = [];
  const nextPlan = withSearchPlanUpdates(plan, draft => {
    expansions = applyTopicExpansion(draft);
  });

  return {
    plan: expansions.length > 0 ? nextPlan : plan,
    expansions,
  };
}

const TOPIC_EXPANSION_STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'class',
  'classes',
  'course',
  'courses',
  'for',
  'the',
]);

function buildTopicExpansionKeywordQuery(
  keywordQuery: string,
  expansions: string[],
): string {
  const terms = [
    keywordQuery,
    ...expansions,
  ]
    .flatMap(text => text.split(/\s+/))
    .map(term => term.trim())
    .filter(Boolean)
    .filter(term => !TOPIC_EXPANSION_STOPWORDS.has(term.toLowerCase()));

  const seen = new Set<string>();
  const uniqueTerms = terms.filter(term => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueTerms.join(' OR ');
}

function applySortIntent(plan: SearchPlan, rawQuery: string): boolean {
  const normalized = rawQuery.toLowerCase();
  let inferredSort: SearchSort | null = null;
  const explicitSortMatch = /\b(?:sort|order|rank)(?:\s+(?:courses?|classes?|results?))?\s+by\s+(avg\s+gpa|gpa|difficulty|workload|quality|professor\s+rating|instructor\s+rating|rating|level|credits?)\b/.exec(normalized);

  if (explicitSortMatch) {
    const field = explicitSortMatch[1];
    if (field.includes('gpa')) {
      inferredSort = { field: 'gpa', direction: 'desc' };
    } else if (field.includes('rating')) {
      inferredSort = { field: 'instructor_rating', direction: 'desc' };
    } else if (field === 'quality') {
      inferredSort = { field: 'quality', direction: 'desc' };
    } else if (field === 'level') {
      inferredSort = { field: 'level', direction: 'asc' };
    } else if (field.startsWith('credit')) {
      inferredSort = { field: 'credits', direction: 'asc' };
    } else {
      inferredSort = { field: 'workload', direction: 'asc' };
    }
  } else if (/\b(?:highest|best|top)\s+(?:avg\s+)?gpa\b|\b(?:avg\s+)?gpa\s+(?:highest|best|top)\b/.test(normalized)) {
    inferredSort = { field: 'gpa', direction: 'desc' };
  } else if (/\b(?:best|top|highest\s+rated)\s+(?:professors?|instructors?)\b|\b(?:professor|instructor)\s+rating\b/.test(normalized)) {
    inferredSort = { field: 'instructor_rating', direction: 'desc' };
  } else if (/\b(?:easiest|least\s+(?:work|workload)|lowest\s+workload)\b/.test(normalized)) {
    inferredSort = { field: 'workload', direction: 'asc' };
    plan.filters.difficulty = plan.filters.difficulty ?? 'easy';
    plan.softPreferences = {
      ...(plan.softPreferences ?? {}),
      lowWorkload: 0.86,
    };
  } else if (/\b(?:hardest|most\s+difficult|highest\s+workload)\b/.test(normalized)) {
    inferredSort = { field: 'workload', direction: 'desc' };
    plan.filters.difficulty = plan.filters.difficulty ?? 'hard';
  }

  if (!inferredSort) {
    return false;
  }

  plan.softPreferences = {
    ...(plan.softPreferences ?? {}),
    inferredSort,
  };
  plan.keywordQuery = removeSortScaffolding(plan.keywordQuery);
  plan.semanticQuery = removeSortScaffolding(plan.semanticQuery);
  return true;
}

export type SortIntentResult = {
  plan: SearchPlan;
  applied: boolean;
  inferredSort?: SearchSort;
};

export function compileSortIntent(plan: SearchPlan, rawQuery: string): SortIntentResult {
  let applied = false;
  const nextPlan = withSearchPlanUpdates(plan, draft => {
    applied = applySortIntent(draft, rawQuery);
  });

  return {
    plan: applied ? nextPlan : plan,
    applied,
    inferredSort: applied ? nextPlan.softPreferences?.inferredSort : undefined,
  };
}

export function removeSortScaffolding(query: string): string {
  return query
    .replace(/\b(?:sort|order|rank)(?:\s+(?:courses?|classes?|results?))?\s+by\s+(?:avg\s+gpa|gpa|difficulty|workload|quality|professor\s+rating|instructor\s+rating|rating|level|credits?)\b/gi, ' ')
    .replace(/\b(?:highest|best|top)\s+(?:avg\s+)?gpa\b/gi, ' ')
    .replace(/\b(?:avg\s+)?gpa\s+(?:highest|best|top)\b/gi, ' ')
    .replace(/\b(?:best|top|highest\s+rated)\s+(?:professors?|instructors?)\b/gi, ' ')
    .replace(/\b(?:professor|instructor)\s+rating\b/gi, ' ')
    .replace(/\b(?:easiest|least\s+(?:work|workload)|lowest\s+workload)\b/gi, ' ')
    .replace(/\b(?:hardest|most\s+difficult|highest\s+workload)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFallbackPlans(plan: SearchPlan, queryResidual: string): SearchPlan[] {
  const existingExpansions = Array.isArray(plan.softPreferences?.topicExpansions)
    ? plan.softPreferences.topicExpansions
    : [];
  if (existingExpansions.length > 0) {
    return [];
  }

  const expandedKeywords = expandTopics(queryResidual);
  if (expandedKeywords.length === 0) {
    return [];
  }

  return [withSearchPlanUpdates(plan, draft => {
    draft.keywordQuery = sanitizeFtsQuery(
      `${plan.keywordQuery} ${expandedKeywords.join(' ')}`,
    );
    draft.semanticQuery = sanitizeFtsQuery(
      `${plan.semanticQuery} ${expandedKeywords.join(' ')}`,
    );
    draft.softPreferences = {
      ...(draft.softPreferences ?? {}),
      topicExpansions: expandedKeywords,
    };
  })];
}
