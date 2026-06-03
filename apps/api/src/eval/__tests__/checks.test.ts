import { describe, expect, it } from 'vitest';
import { checkResultCoherence } from '../checks.js';
import type { GoldQuery } from '../types.js';

function query(expectedResults: GoldQuery['expected_results']): GoldQuery {
  return {
    id: 9001,
    query: 'test query',
    expected_filters: {},
    expected_residual: '',
    expected_results: expectedResults,
    category: 'decision',
  };
}

const culturalStudiesResult = {
  id: '2026-spring-CLCV-100',
  title: 'Classical Mythology',
  subject: 'CLCV',
  number: '100',
  gened: 'CS',
  geneds: [
    {
      categoryId: 'CS',
      category_id: 'CS',
      attributeCode: 'WCC',
      attribute_code: 'WCC',
    },
  ],
};

describe('result coherence checks', () => {
  it('matches required gen-ed selectors against the full gened set, not just the flattened code', () => {
    const violations = checkResultCoherence(
      query({
        non_empty: true,
        top_k: 1,
        must_include: [{ gened: 'WCC' }],
        all_top_k: { gened: 'WCC' },
      }),
      [culturalStudiesResult],
    );

    expect(violations).toEqual([]);
  });

  it('keeps supporting legacy flattened gen-ed checks', () => {
    const violations = checkResultCoherence(
      query({
        top_k: 1,
        must_include: [{ gened: 'CS' }],
        all_top_k: { gened: 'CS' },
      }),
      [culturalStudiesResult],
    );

    expect(violations).toEqual([]);
  });

  it('fails when neither flattened nor full gen-ed data satisfies the expectation', () => {
    const violations = checkResultCoherence(
      query({
        top_k: 1,
        all_top_k: { gened: 'US' },
      }),
      [culturalStudiesResult],
    );

    expect(violations).toEqual([
      'Result 2026-spring-CLCV-100 gened=CS, expected US',
    ]);
  });
});
