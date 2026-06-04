import { describe, expect, it } from 'vitest';
import { parseCourseDetailHttpRequest } from '../course-detail-request.js';

describe('parseCourseDetailHttpRequest', () => {
  it('normalizes valid course detail path params into a service request', () => {
    expect(parseCourseDetailHttpRequest({
      rawSubject: 'cs',
      rawNumber: '225',
      requestedYear: '2026',
      requestedTerm: 'spring',
      fresh: 'true',
      maxYear: 2028,
    })).toEqual({
      ok: true,
      request: {
        subject: 'CS',
        number: '225',
        requestedYear: '2026',
        requestedTerm: 'spring',
        bypassCache: true,
      },
    });
  });

  it('treats no-cache as a cache bypass', () => {
    expect(parseCourseDetailHttpRequest({
      rawSubject: 'CS',
      rawNumber: '225',
      cacheControl: 'max-age=0, no-cache',
    })).toMatchObject({
      ok: true,
      request: {
        bypassCache: true,
      },
    });
  });

  it('requires year and term together', () => {
    expect(parseCourseDetailHttpRequest({
      rawSubject: 'CS',
      rawNumber: '225',
      requestedYear: '2026',
    })).toEqual({
      ok: false,
      status: 400,
      body: { error: 'year and term must be provided together' },
    });
  });

  it('validates requested year and term values', () => {
    expect(parseCourseDetailHttpRequest({
      rawSubject: 'CS',
      rawNumber: '225',
      requestedYear: '2035',
      requestedTerm: 'spring',
      maxYear: 2028,
    })).toEqual({
      ok: false,
      status: 400,
      body: { error: 'year must be between 2004 and 2028' },
    });

    expect(parseCourseDetailHttpRequest({
      rawSubject: 'CS',
      rawNumber: '225',
      requestedYear: '2026',
      requestedTerm: 'autumn',
      maxYear: 2028,
    })).toEqual({
      ok: false,
      status: 400,
      body: { error: 'term must be one of: winter, spring, summer, fall' },
    });
  });
});
