import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyTerm, discoverAllTerms } from '../term-discovery.js';
import { browserFetch } from '../../http/browser-fetch.js';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
}

describe('term discovery', () => {
  beforeEach(() => {
    vi.mocked(browserFetch).mockReset();
  });

  it('discovers every available winter, spring, summer, and fall term in the configured range', async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(xmlResponse(termListXml(2004, ['fall'])))
      .mockResolvedValueOnce(xmlResponse(termListXml(
        2005,
        ['winter', 'spring', 'summer', 'fall'],
      )));

    await expect(discoverAllTerms({
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
    expect(vi.mocked(browserFetch).mock.calls.map(call => call[0])).toEqual([
      'https://cis.example.test/schedule/2004.xml',
      'https://cis.example.test/schedule/2005.xml',
    ]);
  });

  it.each([
    {
      name: 'a duplicate term',
      xml: termListXml(2026, ['fall', 'fall']),
      error: /Duplicate fall term/,
    },
    {
      name: 'an href for a different year',
      xml: calendarYearXml(
        2026,
        '<term href="https://cis.example.test/schedule/2025/fall.xml">Fall 2026</term>',
      ),
      error: /Invalid term href/,
    },
    {
      name: 'a mismatched label',
      xml: calendarYearXml(
        2026,
        '<term href="https://cis.example.test/schedule/2026/fall.xml">Spring 2026</term>',
      ),
      error: /Invalid term label/,
    },
    {
      name: 'an unsupported term',
      xml: calendarYearXml(
        2026,
        '<term href="https://cis.example.test/schedule/2026/autumn.xml">Autumn 2026</term>',
      ),
      error: /Invalid term href/,
    },
    {
      name: 'a missing href',
      xml: calendarYearXml(2026, '<term>Fall 2026</term>'),
      error: /href and label are required/,
    },
    {
      name: 'a non-term root child',
      xml: calendarYearXml(
        2026,
        '<semester href="https://cis.example.test/schedule/2026/fall.xml">Fall 2026</semester>',
      ),
      error: /malformed term markup/,
    },
    {
      name: 'unclosed XML',
      xml: [
        '<ns2:calendarYear xmlns:ns2="urn:course-explorer" id="2026">',
        '<label>2026</label><terms>',
        '<term href="https://cis.example.test/schedule/2026/fall.xml">Fall 2026',
        '</terms></ns2:calendarYear>',
      ].join(''),
      error: /malformed term markup/,
    },
    {
      name: 'a mismatched calendar year id',
      xml: calendarYearXml(
        2026,
        '<term href="https://cis.example.test/schedule/2026/fall.xml">Fall 2026</term>',
        { id: 2025 },
      ),
      error: /calendarYear id mismatch/,
    },
    {
      name: 'a mismatched calendar year label',
      xml: calendarYearXml(
        2026,
        '<term href="https://cis.example.test/schedule/2026/fall.xml">Fall 2026</term>',
        { label: 2025 },
      ),
      error: /expected matching label/,
    },
    {
      name: 'multiple term containers',
      xml: [
        '<ns2:calendarYear xmlns:ns2="urn:course-explorer" id="2026">',
        '<label>2026</label>',
        '<terms><term href="https://cis.example.test/schedule/2026/fall.xml">Fall 2026</term></terms>',
        '<terms><term href="https://cis.example.test/schedule/2026/spring.xml">Spring 2026</term></terms>',
        '</ns2:calendarYear>',
      ].join(''),
      error: /malformed term markup/,
    },
  ])('rejects $name instead of partially inventing a year', async ({ xml, error }) => {
    vi.mocked(browserFetch).mockResolvedValueOnce(xmlResponse(xml));

    await expect(discoverAllTerms({
      cisapiBase: 'https://cis.example.test',
      fromYear: 2026,
      toYear: 2026,
    })).rejects.toThrow(error);
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

function termListXml(
  year: number,
  terms: Array<'winter' | 'spring' | 'summer' | 'fall'>,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    calendarYearXml(year, terms.map(term => (
      `<term href="https://cis.example.test/schedule/${year}/${term}.xml">`
      + `${term[0].toUpperCase()}${term.slice(1)} ${year}</term>`
    )).join('')),
  ].join('');
}

function calendarYearXml(
  year: number,
  termMarkup: string,
  overrides: { id?: number; label?: number } = {},
): string {
  return [
    `<ns2:calendarYear xmlns:ns2="urn:course-explorer" id="${overrides.id ?? year}">`,
    `<label>${overrides.label ?? year}</label>`,
    `<terms>${termMarkup}</terms>`,
    '</ns2:calendarYear>',
  ].join('');
}
