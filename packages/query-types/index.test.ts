import { describe, expect, it } from 'vitest';
import {
  buildCourseExplorerCourseUrl,
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
  getQualityTierLabel,
  getQualityTierRank,
  getWorkloadTierLabel,
  getWorkloadTierRank,
  requirementFilter,
  coerceSearchRequestDto,
  decodeSearchRequestQuery,
  searchRequestToQueryEntries,
  toNormalizedQualityScore,
} from './index.js';

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

  it('keeps workload filters aligned with displayed workload tiers', () => {
    expect(getWorkloadTierLabel(45)).toBe('Easy');
    expect(getWorkloadTierLabel(46)).toBe('Moderate');
    expect(getWorkloadTierLabel(75)).toBe('Moderate');
    expect(getWorkloadTierLabel(76)).toBe('Hard');
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
  it('normalizes public request filters without backend planner names', () => {
    expect(coerceSearchRequestDto({
      query: 'online stats class',
      filters: {
        subject: ' stat ',
        requirement: requirementFilter('single', [' hum ']),
        online: true,
      },
      scope: 'all',
      sort: { field: 'gpa', direction: 'desc' },
    })).toEqual({
      query: 'online stats class',
      filters: {
        subject: 'STAT',
        requirement: { mode: 'single', codes: ['HUM'] },
        online: true,
      },
      sort: { field: 'gpa', direction: 'desc' },
      scope: 'all',
    });
  });

  it('normalizes invalid sort and scope controls back to defaults', () => {
    expect(coerceSearchRequestDto({
      query: 'history',
      sort: { field: 'not-real', direction: 'sideways' } as never,
      scope: 'past' as never,
      filters: { level: 700 as never },
    })).toEqual({
      query: 'history',
      filters: {},
      sort: { field: 'relevance', direction: 'desc' },
      scope: 'active',
    });
  });

  it('serializes and decodes search URL params through the canonical codec', () => {
    const entries = searchRequestToQueryEntries({
      query: 'online stats class',
      filters: {
        subject: ' stat ',
        requirement: requirementFilter('any', [' hum ', 'us ']),
        online: true,
        workload: 'easy',
      },
      sort: { field: 'gpa', direction: 'desc' },
      scope: 'all',
      pagination: { limit: 25, offset: 50 },
    });

    expect(entries).toEqual([
      ['q', 'online stats class'],
      ['limit', '25'],
      ['offset', '50'],
      ['subject', 'STAT'],
      ['requirement', 'HUM,US'],
      ['requirementMode', 'any'],
      ['online', 'true'],
      ['workload', 'easy'],
      ['scope', 'all'],
      ['sort', 'gpa'],
      ['direction', 'desc'],
    ]);

    const decoded = decodeSearchRequestQuery(paramReader(entries));
    expect(decoded).toEqual({
      ok: true,
      value: {
        request: {
          query: 'online stats class',
          filters: {
            subject: 'STAT',
            requirement: { mode: 'any', codes: ['HUM', 'US'] },
            online: true,
            workload: 'easy',
          },
          sort: { field: 'gpa', direction: 'desc' },
          scope: 'all',
        },
        pagination: { limit: 25, offset: 50 },
      },
    });
  });

  it('rejects invalid explicit URL controls instead of silently reinterpreting them', () => {
    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'history'],
      ['sort', 'not-real'],
    ]))).toEqual({
      ok: false,
      error: 'sort must be one of: relevance, gpa, quality, workload, instructor_rating, level, credits',
    });

    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'history'],
      ['scope', 'past'],
    ]))).toEqual({
      ok: false,
      error: 'scope must be one of: active, all',
    });

    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'history'],
      ['sort', 'gpa'],
      ['direction', 'sideways'],
    ]))).toEqual({
      ok: false,
      error: 'direction must be one of: asc, desc',
    });

    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'history'],
      ['level', '700'],
    ]))).toEqual({
      ok: false,
      error: 'level must be one of: 100, 200, 300, 400, 500',
    });
  });

  it('decodes multiple requirement codes as any-match unless a mode is explicit', () => {
    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'easy gen ed'],
      ['requirement', 'hum, us'],
    ]))).toEqual({
      ok: true,
      value: {
        request: {
          query: 'easy gen ed',
          filters: {
            requirement: { mode: 'any', codes: ['HUM', 'US'] },
          },
          sort: { field: 'relevance', direction: 'desc' },
          scope: 'active',
        },
        pagination: { limit: 20, offset: 0 },
      },
    });

    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'easy gen ed'],
      ['requirement', 'hum, us'],
      ['requirementMode', 'single'],
    ]))).toEqual({
      ok: false,
      error: 'requirement must contain one code when requirementMode is single',
    });
  });
});

function paramReader(entries: Array<[string, string]>): { get(name: string): string | null } {
  return {
    get(name) {
      return entries.find(([key]) => key === name)?.[1] ?? null;
    },
  };
}
