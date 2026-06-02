import { describe, expect, it, vi } from 'vitest';
import { classifyTerm, discoverAllTerms } from '../term-discovery.js';
import { browserFetch } from '../../http/browser-fetch.js';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
}

describe('term discovery', () => {
  it('discovers every available winter, spring, summer, and fall term in the configured range', async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(jsonResponse({ Fall: 'fall' }))
      .mockResolvedValueOnce(jsonResponse({ Winter: 'winter', Spring: 'spring', Summer: 'summer', Fall: 'fall' }));

    await expect(discoverAllTerms({
      frontendBase: 'https://courses.example.test',
      cisapiBase: 'https://cis.example.test',
      fromYear: 2004,
      toYear: 2005,
    })).resolves.toEqual([
      { year: 2004, term: 'fall', termId: '2004-fall' },
      { year: 2005, term: 'winter', termId: '2005-winter' },
      { year: 2005, term: 'spring', termId: '2005-spring' },
      { year: 2005, term: 'summer', termId: '2005-summer' },
      { year: 2005, term: 'fall', termId: '2005-fall' },
    ]);
  });

  it('classifies any term with open-like section statuses as registrable', async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(xmlResponse('<subjects><subject id="CS"/><subject id="MATH"/></subjects>'))
      .mockResolvedValueOnce(xmlResponse(`
        <subject>
          <enrollmentStatus>UNKNOWN</enrollmentStatus>
          <enrollmentStatus>Open (Restricted)</enrollmentStatus>
        </subject>
      `));

    await expect(classifyTerm({
      frontendBase: 'https://courses.example.test',
      cisapiBase: 'https://cis.example.test',
    }, {
      year: 2026,
      term: 'fall',
      termId: '2026-fall',
    })).resolves.toMatchObject({
      status: 'registrable',
      sampledSubjects: ['CS', 'MATH'],
      sampleEnrollmentStatuses: ['UNKNOWN', 'Open (Restricted)'],
    });
  });
});
