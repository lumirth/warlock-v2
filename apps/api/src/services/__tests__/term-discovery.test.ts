import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTermListXml } from '../../cisapi/parser.js';
import { browserFetch } from '../../http/browser-fetch.js';
import { classifyTerm, discoverAllTerms } from '../term-discovery.js';

vi.mock('../../http/browser-fetch.js', () => ({ browserFetch: vi.fn() }));
const BASE = 'https://cis.example.test';
const response = (body: string) => new Response(body, { status: 200 });
const year = (terms: string, id = '2026', label = '2026') =>
  `<calendarYear id="${id}"><label>${label}</label><terms>${terms}</terms></calendarYear>`;
const term = (name: string, href = `${BASE}/schedule/2026/${name}.xml`) =>
  `<term href="${href}">${name[0]?.toUpperCase()}${name.slice(1)} 2026</term>`;

describe('term-list trust boundary', () => {
  beforeEach(() => vi.mocked(browserFetch).mockReset());

  it('discovers and chronologically orders the authoritative terms', async () => {
    vi.mocked(browserFetch).mockResolvedValue(response(year(term('fall') + term('spring'))));
    await expect(discoverAllTerms({ cisapiBase: BASE, fromYear: 2026, toYear: 2026 }))
      .resolves.toEqual([
        { year: 2026, term: 'spring', termId: '2026-spring' },
        { year: 2026, term: 'fall', termId: '2026-fall' },
      ]);
  });

  it.each([
    ['wrong root', '<terms></terms>'],
    ['wrong year', year(term('fall'), '2025')],
    ['wrong label', year(term('fall'), '2026', '2025')],
    ['cross-origin href', year(term('fall', 'https://evil.test/schedule/2026/fall.xml'))],
    ['duplicate term', year(term('fall') + term('fall'))],
    ['unclosed XML', '<calendarYear id="2026"><label>2026</label><terms><term>Fall 2026</terms>'],
  ])('rejects %s instead of inventing catalog state', (_name, xml) => {
    expect(() => parseTermListXml(xml, { requestedYear: 2026, cisapiBase: BASE })).toThrow();
  });

  it('classifies an open-like enrollment status as registrable', async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(response('<subjects><subject id="CS"/></subjects>'))
      .mockResolvedValueOnce(response('<subject><enrollmentStatus>Open (Restricted)</enrollmentStatus></subject>'));

    await expect(classifyTerm({ cisapiBase: BASE }, {
      year: 2026, term: 'fall', termId: '2026-fall',
    })).resolves.toMatchObject({
      status: 'registrable', sampledSubjects: ['CS'],
      sampleEnrollmentStatuses: ['Open (Restricted)'],
    });
  });
});
