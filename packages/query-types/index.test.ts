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
});
