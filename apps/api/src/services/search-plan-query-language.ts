import {
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTimeFilter,
  requirementFilter,
  singleRequirementFilter,
} from '@uiuc-course-search/query-types';
import { parseTermValue } from './query-resolver.js';
import {
  applyStructuredNegation,
  parseBooleanFilterValue,
} from './search-intent-policy.js';
import type {
  FieldFilter,
  ParsedQuery,
  SearchPlan,
} from './search-planner-types.js';
import { withSearchPlanUpdates } from './search-plan-model.js';
import {
  compilerEvent,
  type SearchCompilerEvent,
} from './search-planning-types.js';

export function appendQueryText(current: string, addition: string): string {
  return [current, addition].filter(Boolean).join(' ').trim();
}

type QueryLanguageClauseResult = {
  plan: SearchPlan;
  events: SearchCompilerEvent[];
};

export function compileQueryLanguage(
  queryLanguage: ParsedQuery,
  inputPlan: SearchPlan,
): QueryLanguageClauseResult {
  const events: SearchCompilerEvent[] = [];

  const plan = withSearchPlanUpdates(inputPlan, draft => {
    for (const filter of queryLanguage.filters) {
      applyFieldFilter(filter, draft);
    }
    if (queryLanguage.filters.length > 0) {
      events.push(
        compilerEvent('compile', 'query_language_filters', 'Applied explicit query-language filters', {
          fields: queryLanguage.filters.map((filter) => filter.field),
        }),
      );
    }

    if (queryLanguage.requirementMode) {
      if (queryLanguage.requirementMode.any) {
        draft.filters.requirement = requirementFilter('any', queryLanguage.requirementMode.any);
      }
      if (queryLanguage.requirementMode.all) {
        draft.filters.requirement = requirementFilter('all', queryLanguage.requirementMode.all);
      }
      events.push(
        compilerEvent('compile', 'query_language_requirements', 'Applied explicit requirement mode', {
          mode: queryLanguage.requirementMode.any ? 'any' : 'all',
        }),
      );
    }

    for (const negation of queryLanguage.negations) {
      applyNegationToken(negation, draft);
    }
    if (queryLanguage.negations.length > 0) {
      events.push(
        compilerEvent('compile', 'query_language_negations', 'Applied explicit query-language negations', {
          negations: queryLanguage.negations,
        }),
      );
    }

    if (queryLanguage.phrases.length > 0) {
      const keywordPhrases = queryLanguage.phrases
        .map((phrase) => `"${phrase.replace(/"/g, '""')}"`)
        .join(' ');
      const semanticPhrases = queryLanguage.phrases.join(' ');
      draft.keywordQuery = appendQueryText(draft.keywordQuery, keywordPhrases);
      draft.semanticQuery = appendQueryText(draft.semanticQuery, semanticPhrases);
      events.push(
        compilerEvent('compile', 'quoted_phrases', 'Added quoted phrases to retrieval query text', {
          phrases: queryLanguage.phrases,
        }),
      );
    }
  });

  return { plan, events };
}

function applyFieldFilter(filter: FieldFilter, plan: SearchPlan): void {
  if (filter.negated) {
    applyStructuredNegation(filter.field, filter.value, plan);
    return;
  }

  switch (filter.field) {
    case 'subject':
      plan.filters.subject = filter.value.toUpperCase();
      break;
    case 'requirement':
      plan.filters.requirement = singleRequirementFilter(filter.value);
      break;
    case 'credits': {
      const credits = parseInt(filter.value, 10);
      if (!Number.isNaN(credits)) plan.filters.credits = credits;
      break;
    }
    case 'level': {
      const level = parseInt(filter.value, 10);
      if (isSearchLevelFilter(level)) plan.filters.level = level;
      break;
    }
    case 'crn':
      plan.filters.crn = filter.value;
      break;
    case 'status':
      {
        const status = filter.value.toLowerCase();
        if (isSearchStatusFilter(status)) {
          plan.filters.status = status;
        }
      }
      break;
    case 'online': {
      const online = parseBooleanFilterValue(filter.value);
      if (online !== undefined) plan.filters.online = online;
      break;
    }
    case 'days':
      plan.filters.days = filter.value.toUpperCase();
      break;
    case 'time':
      {
        const time = filter.value.toLowerCase();
        if (isSearchTimeFilter(time)) {
          plan.filters.time = time;
        }
      }
      break;
    case 'term': {
      const parsed = parseTermValue(filter.value);
      if (parsed) {
        plan.filters.term = parsed.term;
        plan.filters.year = parsed.year;
      }
      break;
    }
    case 'partofterm':
      plan.filters.partOfTerm = filter.value.toUpperCase();
      break;
    case 'instructor_difficulty':
      if (filter.value === 'lower' || filter.value === 'higher') {
        plan.filters.instructorDifficulty = filter.value;
      }
      break;
  }
}

function applyNegationToken(token: string, plan: SearchPlan): void {
  const normalized = token.toLowerCase();
  const fieldMatch = /^(subject|requirement|keyword):(.+)$/.exec(normalized);
  if (fieldMatch) {
    applyStructuredNegation(fieldMatch[1], fieldMatch[2], plan);
    return;
  }

  const timeWords = new Set([
    'early',
    'morning',
    'midday',
    'afternoon',
    'evening',
    'night',
  ]);
  const dayWords = new Set([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'mwf',
    'tr',
    'mw',
    'wf',
    'm',
    't',
    'w',
    'r',
    'f',
  ]);

  if (timeWords.has(normalized)) {
    plan.filters.not = plan.filters.not || {};
    plan.filters.not.time = plan.filters.not.time || [];
    plan.filters.not.time.push(normalized === 'night' ? 'evening' : normalized);
    return;
  }

  if (dayWords.has(normalized)) {
    plan.filters.not = plan.filters.not || {};
    plan.filters.not.days = plan.filters.not.days || [];
    plan.filters.not.days.push(normalized);
    return;
  }

  if (['online', 'remote', 'virtual'].includes(normalized)) {
    plan.filters.online = false;
  }
}
