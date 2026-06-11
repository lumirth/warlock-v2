import { describe, expect, it } from 'vitest';
import { checkResultCoherence, evaluatePublicSearchResponse, normalizeApiSearchResults } from '../checks.js';
import type { GoldQuery } from '../types.js';

function query(expectedResults: GoldQuery['expected_results']): GoldQuery {
  return {
    id: 9001,
    query: 'test query',
    expected_filters: {},
    expected_results: expectedResults,
    category: 'decision',
  };
}

const culturalStudiesResult = {
  id: '2026-spring-CLCV-100',
  title: 'Classical Mythology',
  subject: 'CLCV',
  number: '100',
  requirements: [
    {
      categoryId: 'CS',
      category_id: 'CS',
      attributeCode: '1WCC',
      attribute_code: '1WCC',
    },
  ],
};

describe('result coherence checks', () => {
  it('fails a query that requires non-empty results when search returns nothing', () => {
    const violations = checkResultCoherence(
      query({
        non_empty: true,
        top_k: 10,
      }),
      [],
    );

    expect(violations).toEqual(['results expected to be non-empty']);
  });

  it('matches required requirement selectors against the full requirement set, not just the flattened code', () => {
    const violations = checkResultCoherence(
      query({
        non_empty: true,
        top_k: 1,
        must_include: [{ requirement: 'WCC' }],
        all_top_k: { requirement: 'WCC' },
      }),
      [culturalStudiesResult],
    );

    expect(violations).toEqual([]);
  });

  it('fails when the full requirement set does not satisfy the expectation', () => {
    const violations = checkResultCoherence(
      query({
        top_k: 1,
        all_top_k: { requirement: 'US' },
      }),
      [culturalStudiesResult],
    );

    expect(violations).toEqual([
      'Result 2026-spring-CLCV-100 does not include requirement US',
    ]);
  });

  it('normalizes public nested search results before evaluating result coherence', () => {
    const publicResult = {
      course: {
        id: 'CS-225-2026-fall',
        subject: 'CS',
        number: '225',
        title: 'Data Structures',
        metrics: { avgGpa: 3.12 },
        requirements: [
          {
            categoryId: 'QR',
            categoryName: 'Quantitative Reasoning',
            attributeCode: 'QR2',
            attributeName: 'Quantitative Reasoning II',
          },
        ],
      },
    };

    expect(normalizeApiSearchResults([publicResult])).toEqual([
      {
        id: 'CS-225-2026-fall',
        subject: 'CS',
        number: '225',
        title: 'Data Structures',
        avg_gpa: 3.12,
        requirements: [
          {
            categoryId: 'QR',
            category_id: undefined,
            attributeCode: 'QR2',
            attribute_code: undefined,
          },
        ],
      },
    ]);

    const result = evaluatePublicSearchResponse(
      {
        ...query({
          non_empty: true,
          top_k: 1,
          all_top_k: { subjects: ['CS'], requirement: 'QR' },
        }),
        invariants: { subject: 'CS', requirement: 'QR' },
      },
      {
        results: [publicResult],
      },
    );

    expect(result.violations).toEqual([]);
  });
});
