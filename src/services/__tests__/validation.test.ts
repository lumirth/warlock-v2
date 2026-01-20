import { describe, it, expect } from 'vitest';
import { validateSyncResult } from '../validation.js';
import type { TermSyncResult } from '../parallel-sync.js';

const baseResult: TermSyncResult = {
  termId: '2026-spring',
  year: 2026,
  term: 'spring',
  subjectResults: [],
  totalCourses: 0,
  totalSections: 0,
  successfulSubjects: 0,
  failedSubjects: 0,
  durationMs: 1000,
  rateLimitHits: 0
};

describe('validateSyncResult', () => {
  it('returns no warnings for healthy sync', () => {
    const result: TermSyncResult = {
      ...baseResult,
      totalCourses: 4500,
      totalSections: 20000,
      successfulSubjects: 180,
      failedSubjects: 0
    };

    const warnings = validateSyncResult(result);
    expect(warnings).toEqual([]);
  });

  it('warns when courses exist but sections are 0 (parser bug)', () => {
    const result: TermSyncResult = {
      ...baseResult,
      totalCourses: 4500,
      totalSections: 0
    };

    const warnings = validateSyncResult(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('CRITICAL');
    expect(warnings[0]).toContain('0 sections');
  });

  it('warns when spring term has too few courses', () => {
    const result: TermSyncResult = {
      ...baseResult,
      term: 'spring',
      totalCourses: 500,
      totalSections: 2000
    };

    const warnings = validateSyncResult(result);
    expect(warnings.some(w => w.includes('Only 500 courses'))).toBe(true);
  });

  it('does not warn for low course count in summer term', () => {
    const result: TermSyncResult = {
      ...baseResult,
      term: 'summer',
      totalCourses: 500,
      totalSections: 2000
    };

    const warnings = validateSyncResult(result);
    expect(warnings.some(w => w.includes('Only 500 courses'))).toBe(false);
  });

  it('warns when subject failure rate exceeds 10%', () => {
    const result: TermSyncResult = {
      ...baseResult,
      totalCourses: 4000,
      totalSections: 18000,
      successfulSubjects: 150,
      failedSubjects: 30
    };

    const warnings = validateSyncResult(result);
    expect(warnings.some(w => w.includes('failed'))).toBe(true);
  });
});
