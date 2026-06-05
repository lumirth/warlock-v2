import { describe, expect, it } from 'vitest';
import { requirementFilter, singleRequirementFilter } from '@uiuc-course-search/query-types';
import type { SearchPlan } from '../search-planner-types.js';
import { compileDecisionSearchRescue } from '../decision-plan.js';
import { GENERIC_REQUIREMENT_CODES } from '../requirement-codes.js';

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    filters: {},
    keywordQuery: '',
    semanticQuery: '',
    ...overrides,
  };
}

describe('compileDecisionSearchRescue', () => {
  it('turns generic gened language into an explicit any-GenEd constraint', () => {
    const searchPlan = plan({
      filters: { workload: 'easy' },
    });

    const result = compileDecisionSearchRescue(searchPlan, 'easy cs gened', '');

    expect(result.plan.filters).toMatchObject({
      workload: 'easy',
      requirement: requirementFilter('any', GENERIC_REQUIREMENT_CODES),
    });
    expect(result.plan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'subjective_vibe']));
    expect(searchPlan).toEqual({
      filters: { workload: 'easy' },
      keywordQuery: '',
      semanticQuery: '',
    });
  });

  it('does not broaden a specific GenEd bucket into generic any-GenEd', () => {
    const searchPlan = plan({
      filters: { requirement: singleRequirementFilter('CS'), workload: 'easy' },
    });

    const result = compileDecisionSearchRescue(searchPlan, 'easy cs gened', '');

    expect(result.plan.filters).toMatchObject({
      requirement: singleRequirementFilter('CS'),
      workload: 'easy',
    });
    expect(result.plan.filters.requirement?.mode).toBe('single');
    expect(result.plan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'subjective_vibe']));
  });

  it('does not convert ambiguous counts language into a fake GenEd filter', () => {
    const searchPlan = plan();

    const result = compileDecisionSearchRescue(searchPlan, 'counts for something', '');

    expect(result.plan.filters.requirement).toBeUndefined();
    expect(result.plan.rescue?.queryTypes).toEqual(expect.arrayContaining(['requirement', 'degree_progress']));
    expect(result.plan.rescue?.needsStudentProfile).toBe(true);
  });
});
