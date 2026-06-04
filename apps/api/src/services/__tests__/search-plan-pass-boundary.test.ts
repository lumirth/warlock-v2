import { describe, expect, it } from 'vitest';
import type { ParsedClause, SearchPlan } from '../search-planner-types.js';
import { compileDecisionSearchExpansions } from '../decision-plan.js';
import { compileSortIntent } from '../search-plan-intent-passes.js';
import { compileQueryLanguageClause } from '../search-plan-query-language.js';

describe('search plan pass boundaries', () => {
  it('applies query-language filters to a new plan without mutating the input', () => {
    const basePlan: SearchPlan = {
      filters: {
        not: { days: ['monday'] },
      },
      keywordQuery: '',
      semanticQuery: '',
    };
    const clause: ParsedClause = {
      filters: [{ field: 'subject', value: 'cs' }],
      negations: ['friday'],
      phrases: ['data structures'],
      residual: '',
    };

    const result = compileQueryLanguageClause(clause, basePlan);

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
      softPreferences: { lowWorkload: 0.8 },
    };

    const result = compileSortIntent(basePlan, 'sort by gpa film');

    expect(result.applied).toBe(true);
    expect(result.plan).not.toBe(basePlan);
    expect(result.inferredSort).toEqual({ field: 'gpa', direction: 'desc' });
    expect(result.plan.softPreferences).toMatchObject({
      lowWorkload: 0.8,
      inferredSort: { field: 'gpa', direction: 'desc' },
    });
    expect(result.plan.keywordQuery).toBe('film');
    expect(result.plan.semanticQuery).toBe('film');
    expect(Object.keys(result.plan.filters)).toEqual([]);

    expect(basePlan).toEqual({
      filters: {},
      keywordQuery: 'sort by gpa film',
      semanticQuery: 'sort by gpa film',
      softPreferences: { lowWorkload: 0.8 },
    });
  });

  it('syncs rescue expansion terms without mutating the rescue metadata on the input plan', () => {
    const basePlan: SearchPlan = {
      filters: {},
      keywordQuery: '',
      semanticQuery: '',
      rescue: {
        queryTypes: ['topic'],
        negativeTerms: [],
        topicTerms: ['movies'],
        expandedTerms: ['film'],
        assumptions: [],
        warnings: [],
        interpretedLanes: ['official_text'],
        relaxationPlan: [{
          id: 'strict',
          label: 'Keep all interpreted filters and preferences',
          relaxes: [],
          keeps: ['topic'],
        }],
        needsStudentProfile: false,
        confidence: 0.7,
      },
    };

    const nextPlan = compileDecisionSearchExpansions(basePlan, ['cinema', 'film']);

    expect(nextPlan).not.toBe(basePlan);
    expect(nextPlan.rescue?.expandedTerms).toEqual(['film', 'cinema']);
    expect(basePlan.rescue?.expandedTerms).toEqual(['film']);
  });
});
