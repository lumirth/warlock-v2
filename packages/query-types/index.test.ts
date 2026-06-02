import { describe, expect, it } from 'vitest';
import {
  buildCourseExplorerCourseUrl,
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
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
