import { describe, expect, it, vi } from 'vitest';
import {
  buildTermCoverageReport,
  discoverAvailableTerms,
  formatTermCoverageReport,
  parseTermCoverageArgs,
  type TermCoverageArgs,
} from '../term-coverage-plan.ts';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function args(overrides: Partial<TermCoverageArgs> = {}): TermCoverageArgs {
  return {
    fromYear: 2025,
    toYear: 2026,
    frontendBase: 'https://courses.example.test',
    currentYear: 2026,
    currentTerm: 'spring',
    ...overrides,
  };
}

describe('term coverage plan', () => {
  it('parses operator flags', () => {
    expect(parseTermCoverageArgs([
      '--from-year', '2020',
      '--to-year', '2027',
      '--frontend-base', 'https://courses.example.test',
      '--status-input', 'artifacts/sync-status.json',
      '--output', 'artifacts/term-coverage.json',
      '--current-year', '2026',
      '--current-term', 'summer',
    ])).toMatchObject({
      fromYear: 2020,
      toYear: 2027,
      frontendBase: 'https://courses.example.test',
      statusInput: 'artifacts/sync-status.json',
      output: 'artifacts/term-coverage.json',
      currentYear: 2026,
      currentTerm: 'summer',
    });
  });

  it('discovers available terms across years in chronological order', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Fall: 'fall', Spring: 'spring' }))
      .mockResolvedValueOnce(response({ Summer: 'summer' }));

    const discovered = await discoverAvailableTerms(args(), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(discovered.warnings).toEqual([]);
    expect(discovered.terms).toEqual([
      { year: 2025, term: 'spring', term_id: '2025-spring' },
      { year: 2025, term: 'fall', term_id: '2025-fall' },
      { year: 2026, term: 'summer', term_id: '2026-summer' },
    ]);
  });

  it('records warnings instead of stopping the whole plan when a year fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Fall: 'fall' }))
      .mockResolvedValueOnce(response({ error: 'not found' }, 404));

    const discovered = await discoverAvailableTerms(args(), fetcher);

    expect(discovered.terms).toEqual([{ year: 2025, term: 'fall', term_id: '2025-fall' }]);
    expect(discovered.warnings).toEqual(['term list 2026 failed with HTTP 404']);
  });

  it('builds missing, stale, and count-gap backfill commands from sync status', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Fall: 'fall' }))
      .mockResolvedValueOnce(response({ Spring: 'spring', Fall: 'fall' }));
    const status = {
      termStates: [
        {
          term_id: '2025-fall',
          year: 2025,
          term: 'fall',
          status: 'historical',
          courses_count: 0,
          sections_count: 10,
          last_synced: 1780000000,
        },
        {
          term_id: '2026-spring',
          year: 2026,
          term: 'spring',
          status: 'active',
          courses_count: 1200,
          sections_count: 5000,
          last_synced: 1780000000,
        },
      ],
      freshness: {
        staleTermIds: ['2025-fall'],
      },
    };

    const report = await buildTermCoverageReport(args(), {
      fetcher,
      status,
      statusSource: 'sync-status.json',
    });

    expect(report.counts).toMatchObject({
      available_terms: 3,
      present_terms: 2,
      missing_terms: 1,
      stale_terms: 1,
      terms_needing_backfill: 2,
      expected_historical_terms: 1,
    });
    expect(report.terms.find(term => term.term_id === '2025-fall')).toMatchObject({
      expected_status: 'historical',
      needs_backfill: true,
      reason: 'stale in freshness summary',
    });
    expect(report.terms.find(term => term.term_id === '2026-fall')).toMatchObject({
      expected_status: 'active',
      needs_backfill: true,
      reason: 'missing from term_state',
    });
    expect(report.backfill_commands).toEqual([
      expect.stringContaining('--year 2025 --term fall --status historical'),
      expect.stringContaining('--year 2026 --term fall --status active'),
    ]);
    expect(report.freshness_audit_command).toContain('--min-historical-terms 1');
  });

  it('formats a readable markdown coverage report', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ Fall: 'fall' }));
    const report = await buildTermCoverageReport(args({ fromYear: 2025, toYear: 2025 }), {
      fetcher,
      status: null,
    });

    const markdown = formatTermCoverageReport(report);

    expect(markdown).toContain('# Term Coverage Plan');
    expect(markdown).toContain('Terms needing backfill: 1');
    expect(markdown).toContain('2025-fall (historical): missing from term_state');
    expect(markdown).toContain('npm run data:backfill:term');
  });
});
