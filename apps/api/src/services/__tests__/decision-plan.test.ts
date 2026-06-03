import { describe, expect, it } from 'vitest';
import type { SearchPlan } from '@uiuc-course-search/query-types';
import { applyDecisionSearchRescue } from '../decision-plan.js';
import { GENERIC_GENED_CODES } from '../gened-codes.js';

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    filters: {},
    keywordQuery: '',
    semanticQuery: '',
    ...overrides,
  };
}

describe('applyDecisionSearchRescue', () => {
  it('turns generic gened language into an explicit any-GenEd constraint', () => {
    const searchPlan = plan({
      filters: { subject: 'CS', difficulty: 'easy' },
    });

    applyDecisionSearchRescue(searchPlan, 'easy cs gened', '');

    expect(searchPlan.filters).toMatchObject({
      subject: 'CS',
      difficulty: 'easy',
      gened_any: [...GENERIC_GENED_CODES],
    });
    expect(searchPlan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'subjective_vibe']));
  });

  it('does not convert ambiguous counts language into a fake GenEd filter', () => {
    const searchPlan = plan();

    applyDecisionSearchRescue(searchPlan, 'counts for something', '');

    expect(searchPlan.filters.gened_any).toBeUndefined();
    expect(searchPlan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'degree_progress']));
    expect(searchPlan.rescue?.needsStudentProfile).toBe(true);
  });
});
