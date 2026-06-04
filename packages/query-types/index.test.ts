import { describe, expect, it } from 'vitest';
import {
  buildCourseExplorerCourseUrl,
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
  COURSE_USEFULNESS_POLICY,
  getQualityTierLabel,
  getQualityTierRank,
  getWorkloadTierLabel,
  getWorkloadTierRank,
  normalizeGpaWorkload,
  parseSearchRequestQueryParams,
  requirementFilter,
  searchRequestToQueryEntries,
  toNormalizedQualityScore,
  WORKLOAD_FILTER_THRESHOLDS,
} from './index.js';

function params(entries: Array<[string, string]>): { get(name: string): string | null } {
  const map = new Map(entries);
  return {
    get: (name) => map.get(name) ?? null,
  };
}

describe('shared external link builders', () => {
  it('builds official Course Explorer course URLs', () => {
    expect(buildCourseExplorerCourseUrl({
      year: 2026,
      term: 'Spring',
      subject: 'cs',
      number: '374',
    })).toBe('https://courses.illinois.edu/schedule/2026/spring/CS/374');
  });

  it('points section links at the official course schedule page containing the CRN', () => {
    expect(buildCourseExplorerSectionUrl({
      year: 2026,
      term: 'spring',
      subject: 'CS',
      number: '374',
      crn: '12345',
    })).toBe('https://courses.illinois.edu/schedule/2026/spring/CS/374');
  });

  it('only builds direct Rate My Professors URLs for public numeric IDs', () => {
    expect(buildRmpProfessorUrl('85515')).toBe('https://www.ratemyprofessors.com/professor/85515');
    expect(buildRmpProfessorUrl('VGVhY2hlci0xMjM=')).toBeNull();
    expect(buildRmpProfessorUrl(null)).toBeNull();
  });

  it('builds UIUC-scoped Rate My Professors search fallbacks', () => {
    expect(buildRmpSearchUrl('Wade Fagen-Ulmschneider')).toBe(
      'https://www.ratemyprofessors.com/search/professors/1112?q=Wade%20Fagen-Ulmschneider'
    );
    expect(buildRmpSearchUrl('')).toBeNull();
  });
});

describe('shared course score tiers', () => {
  it('maps quality scores to displayed word-label tiers', () => {
    expect(getQualityTierLabel(91)).toBe('Excellent');
    expect(getQualityTierLabel(78)).toBe('Good');
    expect(getQualityTierLabel(62)).toBe('Fair');
    expect(getQualityTierLabel(42)).toBe('Low');
    expect(getQualityTierLabel(null)).toBeNull();
  });

  it('exposes coarse quality ranks rather than raw composite precision', () => {
    expect(getQualityTierRank(91)).toBe(4);
    expect(getQualityTierRank(86)).toBe(4);
    expect(getQualityTierRank(42)).toBe(1);
    expect(getQualityTierRank(undefined)).toBeNull();
  });

  it('maps workload scores to displayed word-label tiers', () => {
    expect(getWorkloadTierLabel(20)).toBe('Easy');
    expect(getWorkloadTierLabel(58)).toBe('Moderate');
    expect(getWorkloadTierLabel(82)).toBe('Hard');
    expect(getWorkloadTierLabel(null)).toBeNull();
  });

  it('exposes coarse workload ranks for easiest-first sorting', () => {
    expect(getWorkloadTierRank(20)).toBe(1);
    expect(getWorkloadTierRank(58)).toBe(2);
    expect(getWorkloadTierRank(82)).toBe(3);
    expect(getWorkloadTierRank(undefined)).toBeNull();
  });

  it('brands normalized scores by clamping to the 0-100 policy scale', () => {
    expect(toNormalizedQualityScore(120)).toBe(100);
    expect(toNormalizedQualityScore(-5)).toBe(0);
    expect(toNormalizedQualityScore(Number.NaN)).toBeNull();
  });

  it('keeps workload filter thresholds in the shared policy layer', () => {
    expect(WORKLOAD_FILTER_THRESHOLDS.easy.max_workload).toBe(30);
    expect(WORKLOAD_FILTER_THRESHOLDS.easy.fallback_min_gpa).toBe(3.5);
    expect(WORKLOAD_FILTER_THRESHOLDS.hard.min_workload).toBe(70);
    expect(WORKLOAD_FILTER_THRESHOLDS.hard.fallback_max_gpa).toBe(3.0);
    expect(normalizeGpaWorkload(3.5)).toBe(0);
  });

  it('names usefulness policy thresholds instead of spreading raw score cutoffs', () => {
    expect(COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_QUALITY_TIER_RANK).toBe(3);
    expect(COURSE_USEFULNESS_POLICY.EASY_INTENT.PREFERRED_WORKLOAD_TIER).toBe('Easy');
    expect(COURSE_USEFULNESS_POLICY.FUSION.QUALITY_TIER_WEIGHT).toBe(0.08);
  });
});

describe('shared requirement policy', () => {
  it('normalizes requirement filter mode and codes', () => {
    expect(requirementFilter('any', [' hum ', 'HUM', 'us'])).toEqual({
      mode: 'any',
      codes: ['HUM', 'US'],
    });
  });

  it('drops empty requirement filters', () => {
    expect(requirementFilter('all', [' ', ''])).toBeUndefined();
  });
});

describe('shared public search contract', () => {
  it('serializes public request filters without backend planner names', () => {
    expect(searchRequestToQueryEntries({
      query: 'online stats class',
      filters: {
        subject: 'stat',
        gened: 'hum',
        online: true,
      },
      scope: 'all',
      sort: { field: 'gpa', direction: 'desc' },
      pagination: { limit: 10, offset: 20 },
    })).toEqual([
      ['q', 'online stats class'],
      ['limit', '10'],
      ['offset', '20'],
      ['subject', 'STAT'],
      ['gened', 'HUM'],
      ['online', 'true'],
      ['scope', 'all'],
      ['sort', 'gpa'],
      ['direction', 'desc'],
    ]);
  });

  it('parses URL params through the same canonical request boundary', () => {
    const parsed = parseSearchRequestQueryParams(params([
      ['q', 'systems'],
      ['subject', 'cs'],
      ['gened', 'hum'],
      ['online', 'true'],
      ['sort', 'quality'],
      ['direction', 'asc'],
      ['scope', 'all'],
      ['limit', '5'],
    ]));

    expect(parsed).toEqual({
      ok: true,
      value: {
        request: {
          query: 'systems',
          filters: {
            subject: 'CS',
            gened: 'HUM',
            online: true,
          },
          sort: { field: 'quality', direction: 'asc' },
          scope: 'all',
        },
        pagination: { limit: 5, offset: 0 },
      },
    });
  });

  it('validates bounded params while falling unknown sort controls back to defaults', () => {
    expect(parseSearchRequestQueryParams(params([
      ['q', 'history'],
      ['limit', '999'],
    ]))).toEqual({
      ok: false,
      error: 'limit must be between 1 and 50',
    });

    expect(parseSearchRequestQueryParams(params([
      ['q', 'history'],
      ['sort', 'unknown'],
      ['direction', 'sideways'],
      ['scope', 'past'],
      ['level', '700'],
    ]))).toEqual({
      ok: true,
      value: {
        request: {
          query: 'history',
          filters: {},
          sort: { field: 'relevance', direction: 'desc' },
          scope: 'active',
        },
        pagination: { limit: 20, offset: 0 },
      },
    });
  });
});
