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
  formatGenEdDisplayLabel,
  requirementFilter,
  normalizeSearchRequestDto,
  decodeSearchRequestQuery,
  GENED_REQUIREMENT_GROUPS,
  canonicalRequirementCode,
  courseRequirementLabel,
  courseRequirementShortLabel,
  resolveRequirementAlias,
  isKnownRequirementCode,
  searchRequestToQueryEntries,
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

  it('normalizes out-of-range scores while assigning public tiers', () => {
    expect(getQualityTierLabel(120)).toBe('Excellent');
    expect(getQualityTierLabel(-5)).toBe('Low');
    expect(getQualityTierLabel(Number.NaN)).toBeNull();
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
    expect(requirementFilter('any', [' hum ', 'HUM', 'us', '1nw', 'cmp'])).toEqual({
      mode: 'any',
      codes: ['HUM', 'US', 'NW', 'COMP1'],
    });
  });

  it('drops empty requirement filters', () => {
    expect(requirementFilter('all', [' ', ''])).toBeUndefined();
  });

  it('owns the public GenEd taxonomy used by request validation and UI controls', () => {
    expect(GENED_REQUIREMENT_GROUPS.map((group) => group.code)).toEqual([
      'COMP1',
      'ACP',
      'CS',
      'HUM',
      'NAT',
      'QR',
      'SBS',
    ]);
    expect(canonicalRequirementCode('1US')).toBe('US');
    expect(canonicalRequirementCode('cmp')).toBe('COMP1');
    expect(isKnownRequirementCode('HP')).toBe(true);
    expect(isKnownRequirementCode('not-a-code')).toBe(false);
  });

  it('resolves requirement labels, aliases, and source codes from one registry', () => {
    expect(resolveRequirementAlias('Natural Sciences & Technology')).toBe('NAT');
    expect(resolveRequirementAlias('minority cultures')).toBe('US');
    expect(resolveRequirementAlias('CMP')).toBe('COMP1');
    expect(resolveRequirementAlias('psych')).toBeNull();
  });

  it('formats public GenEd labels with canonical student-facing codes', () => {
    expect(formatGenEdDisplayLabel(['1US', 'cmp', 'HUM'])).toBe('GenEd US, COMP1, HUM');
  });

  it('owns full and compact course requirement labels', () => {
    const requirement = {
      categoryId: 'CS',
      categoryName: 'Cultural Studies',
      attributeCode: '1US',
      attributeName: 'US Minority Cultures',
    };

    expect(courseRequirementLabel(requirement))
      .toBe('Cultural Studies: US Minority Cultures');
    expect(courseRequirementShortLabel(requirement)).toBe('CS:US');
  });
});

describe('shared public search contract', () => {
  it('normalizes public request filters without backend planner names', () => {
    expect(normalizeSearchRequestDto({
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

  it('rejects invalid values instead of silently dropping programmer errors', () => {
    expect(() => normalizeSearchRequestDto({
      query: 'history',
      sort: { field: 'not-real', direction: 'sideways' } as never,
    })).toThrow('sort field must be one of');
    expect(() => normalizeSearchRequestDto({
      query: 'history',
      scope: 'past' as never,
    })).toThrow('scope must be one of');
    expect(() => normalizeSearchRequestDto({
      query: 'history',
      filters: { level: 700 as never },
    })).toThrow('level must be one of');
    expect(() => searchRequestToQueryEntries({
      query: 'history',
      pagination: { limit: 51 },
    })).toThrow('limit must be an integer between 1 and 50');
    expect(() => searchRequestToQueryEntries({
      query: 'history',
      pagination: { offset: -1 },
    })).toThrow('offset must be an integer between 0 and 1150');
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

  it('decodes multiple requirement codes as all-match unless a mode is explicit', () => {
    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'easy gen ed'],
      ['requirement', 'hum, us'],
    ]))).toEqual({
      ok: true,
      value: {
        request: {
          query: 'easy gen ed',
          filters: {
            requirement: { mode: 'all', codes: ['HUM', 'US'] },
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

  it('rejects unknown requirement codes at the public request boundary', () => {
    expect(decodeSearchRequestQuery(paramReader([
      ['q', 'easy gen ed'],
      ['requirement', 'HUM,ZZ'],
    ]))).toEqual({
      ok: false,
      error: 'unknown requirement code: ZZ',
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
