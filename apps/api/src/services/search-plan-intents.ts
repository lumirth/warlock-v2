import type { SearchSort } from '@uiuc-course-search/query-types';
import type { SearchPlan } from './search-planner-types.js';
import { withSearchPlanUpdates } from './search-plan-model.js';
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

  plan.introductoryGateway = true;
  plan.semanticQuery = '';
  plan.keywordQuery = '';
  return true;
}

type IntroductoryGatewayResult = {
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

type TopicExpansionResult = {
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
  const explicitSortMatch = /\b(?:sort|order|rank)(?:\s+(?:courses?|classes?|results?))?\s+by\s+(avg\s+gpa|gpa|instructor\s+difficulty|rmp\s+difficulty|quality|professor\s+rating|instructor\s+rating|rating|level|credits?)\b/.exec(normalized);

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
      inferredSort = { field: 'instructor_difficulty', direction: 'asc' };
    }
  } else if (/\b(?:highest|best|top)\s+(?:avg\s+)?gpa\b|\b(?:avg\s+)?gpa\s+(?:highest|best|top)\b/.test(normalized)) {
    inferredSort = { field: 'gpa', direction: 'desc' };
  } else if (/\b(?:best|top|highest\s+rated)\s+(?:professors?|instructors?)\b|\b(?:professor|instructor)\s+rating\b/.test(normalized)) {
    inferredSort = { field: 'instructor_rating', direction: 'desc' };
  } else if (/\blowest\s+(?:instructor|rmp)\s+difficulty\b/.test(normalized)) {
    inferredSort = { field: 'instructor_difficulty', direction: 'asc' };
  } else if (/\bhighest\s+(?:instructor|rmp)\s+difficulty\b/.test(normalized)) {
    inferredSort = { field: 'instructor_difficulty', direction: 'desc' };
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

type SortIntentResult = {
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
    .replace(/\b(?:sort|order|rank)(?:\s+(?:courses?|classes?|results?))?\s+by\s+(?:avg\s+gpa|gpa|instructor\s+difficulty|rmp\s+difficulty|quality|professor\s+rating|instructor\s+rating|rating|level|credits?)\b/gi, ' ')
    .replace(/\b(?:highest|best|top)\s+(?:avg\s+)?gpa\b/gi, ' ')
    .replace(/\b(?:avg\s+)?gpa\s+(?:highest|best|top)\b/gi, ' ')
    .replace(/\b(?:best|top|highest\s+rated)\s+(?:professors?|instructors?)\b/gi, ' ')
    .replace(/\b(?:professor|instructor)\s+rating\b/gi, ' ')
    .replace(/\b(?:lowest|highest)\s+(?:instructor|rmp)\s+difficulty\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
