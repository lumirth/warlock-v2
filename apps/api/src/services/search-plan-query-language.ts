import {
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
  ParsedClause,
  SearchPlan,
} from './search-planner-types.js';
import {
  compilerEvent,
  type SearchCompilerEvent,
} from './search-planning-types.js';

export function appendQueryText(current: string, addition: string): string {
  return [current, addition].filter(Boolean).join(' ').trim();
}

export function applyQueryLanguageClause(
  clause: ParsedClause,
  plan: SearchPlan,
): SearchCompilerEvent[] {
  const events: SearchCompilerEvent[] = [];

  for (const filter of clause.filters) {
    applyFieldFilter(filter, plan);
  }
  if (clause.filters.length > 0) {
    events.push(
      compilerEvent('compile', 'query_language_filters', 'Applied explicit query-language filters', {
        fields: clause.filters.map((filter) => filter.field),
      }),
    );
  }

  if (clause.genedMode) {
    if (clause.genedMode.any) {
      plan.filters.requirement = requirementFilter('any', clause.genedMode.any);
    }
    if (clause.genedMode.all) {
      plan.filters.requirement = requirementFilter('all', clause.genedMode.all);
    }
    events.push(
      compilerEvent('compile', 'query_language_requirements', 'Applied explicit requirement mode', {
        mode: clause.genedMode.any ? 'any' : 'all',
      }),
    );
  }

  for (const negation of clause.negations) {
    applyNegationToken(negation, plan);
  }
  if (clause.negations.length > 0) {
    events.push(
      compilerEvent('compile', 'query_language_negations', 'Applied explicit query-language negations', {
        negations: clause.negations,
      }),
    );
  }

  if (clause.phrases.length > 0) {
    const keywordPhrases = clause.phrases
      .map((phrase) => `"${phrase.replace(/"/g, '""')}"`)
      .join(' ');
    const semanticPhrases = clause.phrases.join(' ');
    plan.keywordQuery = appendQueryText(plan.keywordQuery, keywordPhrases);
    plan.semanticQuery = appendQueryText(plan.semanticQuery, semanticPhrases);
    events.push(
      compilerEvent('compile', 'quoted_phrases', 'Added quoted phrases to retrieval query text', {
        phrases: clause.phrases,
      }),
    );
  }

  return events;
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
    case 'gened':
      plan.filters.requirement = singleRequirementFilter(filter.value);
      break;
    case 'credits': {
      const credits = parseInt(filter.value, 10);
      if (!Number.isNaN(credits)) plan.filters.credits = credits;
      break;
    }
    case 'level': {
      const level = parseInt(filter.value, 10);
      if (!Number.isNaN(level)) plan.filters.level = level;
      break;
    }
    case 'crn':
      plan.filters.crn = filter.value;
      break;
    case 'status':
      plan.filters.status = filter.value.toLowerCase();
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
      plan.filters.time = filter.value.toLowerCase();
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
    case 'part_of_term':
    case 'pot':
      plan.filters.partOfTerm = filter.value.toUpperCase();
      break;
    case 'difficulty':
      if (filter.value === 'easy' || filter.value === 'hard') {
        plan.filters.difficulty = filter.value;
      }
      break;
  }
}

function applyNegationToken(token: string, plan: SearchPlan): void {
  const normalized = token.toLowerCase();
  const fieldMatch = /^(subject|gened|keyword|workload):(.+)$/.exec(normalized);
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
