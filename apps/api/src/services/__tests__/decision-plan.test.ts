import { describe, expect, it } from 'vitest';
import { requirementFilter, singleRequirementFilter } from '@uiuc-course-search/query-types';
import type { SearchPlan } from '../search-planner-types.js';
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
      filters: { difficulty: 'easy' },
    });

    applyDecisionSearchRescue(searchPlan, 'easy cs gened', '');

    expect(searchPlan.filters).toMatchObject({
      difficulty: 'easy',
      requirement: requirementFilter('any', GENERIC_GENED_CODES),
    });
    expect(searchPlan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'subjective_vibe']));
  });

  it('does not broaden a specific GenEd bucket into generic any-GenEd', () => {
    const searchPlan = plan({
      filters: { requirement: singleRequirementFilter('CS'), difficulty: 'easy' },
    });

    applyDecisionSearchRescue(searchPlan, 'easy cs gened', '');

    expect(searchPlan.filters).toMatchObject({
      requirement: singleRequirementFilter('CS'),
      difficulty: 'easy',
    });
    expect(searchPlan.filters.requirement?.mode).toBe('single');
    expect(searchPlan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'subjective_vibe']));
  });

  it('does not convert ambiguous counts language into a fake GenEd filter', () => {
    const searchPlan = plan();

    applyDecisionSearchRescue(searchPlan, 'counts for something', '');

    expect(searchPlan.filters.requirement).toBeUndefined();
    expect(searchPlan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'degree_progress']));
    expect(searchPlan.rescue?.needsStudentProfile).toBe(true);
  });
});
