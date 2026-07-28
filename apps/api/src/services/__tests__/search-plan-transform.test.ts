import { describe, expect, it } from 'vitest';
import type { ParsedQuery, SearchPlan } from '../search-planner-types.js';
import { mergeSearchIntentExpansions } from '../search-intent-compiler.js';
import { compileSortIntent } from '../search-plan-intents.js';
import { compileQueryLanguage } from '../search-plan-query-language.js';

describe('search plan transforms', () => {
  it('applies query-language filters to a new plan without mutating the input', () => {
    const basePlan: SearchPlan = {
      filters: {
        not: { days: ['monday'] },
      },
      keywordQuery: '',
      semanticQuery: '',
    };
    const queryLanguage: ParsedQuery = {
      filters: [{ field: 'subject', value: 'cs' }],
      negations: ['friday'],
      phrases: ['data structures'],
      residual: '',
    };

    const result = compileQueryLanguage(queryLanguage, basePlan);

    expect(result.plan).not.toBe(basePlan);
    expect(result.plan.filters).toMatchObject({
      subject: 'CS',
      not: { days: ['monday', 'friday'] },
    });
    expect(result.plan.keywordQuery).toBe('"data structures"');
    expect(result.plan.semanticQuery).toBe('data structures');
    expect(result.events.map(event => event.type)).toEqual([
      'query_language_filters',
      'query_language_negations',
      'quoted_phrases',
    ]);

    expect(basePlan).toEqual({
      filters: {
        not: { days: ['monday'] },
      },
      keywordQuery: '',
      semanticQuery: '',
    });
  });

  it('compiles sort intent to a new plan without rewriting the input query text', () => {
    const basePlan: SearchPlan = {
      filters: {},
      keywordQuery: 'sort by gpa film',
      semanticQuery: 'sort by gpa film',
      softPreferences: { fun: 0.8 },
    };

    const result = compileSortIntent(basePlan, 'sort by gpa film');

    expect(result.applied).toBe(true);
    expect(result.plan).not.toBe(basePlan);
    expect(result.inferredSort).toEqual({ field: 'gpa', direction: 'desc' });
    expect(result.plan.softPreferences).toMatchObject({
      fun: 0.8,
      inferredSort: { field: 'gpa', direction: 'desc' },
    });
    expect(result.plan.keywordQuery).toBe('film');
    expect(result.plan.semanticQuery).toBe('film');
    expect(Object.keys(result.plan.filters)).toEqual([]);

    expect(basePlan).toEqual({
      filters: {},
      keywordQuery: 'sort by gpa film',
      semanticQuery: 'sort by gpa film',
      softPreferences: { fun: 0.8 },
    });
  });

  it('syncs intent expansion terms without mutating the input plan', () => {
    const basePlan: SearchPlan = {
      filters: {},
      keywordQuery: '',
      semanticQuery: '',
      intent: {
        queryTypes: ['topic'],
        negativeTerms: [],
        topicTerms: ['movies'],
        expandedTerms: ['film'],
        warnings: [],
        confidence: 0.7,
      },
    };

    const nextPlan = mergeSearchIntentExpansions(basePlan, ['cinema', 'film']);

    expect(nextPlan).not.toBe(basePlan);
    expect(nextPlan.intent?.expandedTerms).toEqual(['film', 'cinema']);
    expect(basePlan.intent?.expandedTerms).toEqual(['film']);
  });
});
