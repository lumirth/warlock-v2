import { describe, expect, it, vi } from 'vitest';
import {
  buildTermRetentionReport,
  formatTermRetentionReport,
  generatePruneSql,
  parseTermRetentionArgs,
  type TermRetentionArgs,
  type TermRetentionRow,
} from '../term-retention-plan.ts';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function args(overrides: Partial<TermRetentionArgs> = {}): TermRetentionArgs {
  return {
    fromYear: 2024,
    toYear: 2026,
    frontendBase: 'https://courses.example.test',
    currentYear: 2026,
    currentTerm: 'spring',
    targetSizeMb: 250,
    ...overrides,
  };
}

function termState(termId: string, status = 'historical') {
  const [year, term] = termId.split('-');
  return {
    term_id: termId,
    year: Number.parseInt(year, 10),
    term,
    status,
    courses_count: 100,
    sections_count: 200,
    last_synced: 1780000000,
  };
}

function sizedTermState(termId: string, coursesCount: number, sectionsCount: number) {
  return {
    ...termState(termId),
    courses_count: coursesCount,
    sections_count: sectionsCount,
  };
}

describe('term retention plan', () => {
  it('parses operator flags', () => {
    expect(parseTermRetentionArgs([
      '--from-year', '2020',
      '--to-year', '2027',
      '--frontend-base', 'https://courses.example.test',
      '--status-input', 'artifacts/sync-status.json',
      '--output', 'artifacts/term-retention-plan.json',
      '--sql-output', 'artifacts/term-retention-prune.sql',
      '--current-year', '2026',
      '--current-term', 'summer',
      '--target-size-mb', '250',
      '--max-retained-terms', '12',
    ])).toMatchObject({
      fromYear: 2020,
      toYear: 2027,
      frontendBase: 'https://courses.example.test',
      statusInput: 'artifacts/sync-status.json',
      output: 'artifacts/term-retention-plan.json',
      sqlOutput: 'artifacts/term-retention-prune.sql',
      currentYear: 2026,
      currentTerm: 'summer',
      targetSizeMb: 250,
      maxRetainedTerms: 12,
    });
  });

  it('pins registrable and active terms while dropping old terms outside the rolling window', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Fall: 'fall', Spring: 'spring' }))
      .mockResolvedValueOnce(response({ Fall: 'fall', Spring: 'spring', Summer: 'summer', Winter: 'winter' }))
      .mockResolvedValueOnce(response({ Fall: 'fall', Spring: 'spring', Summer: 'summer', Winter: 'winter' }));
    const status = {
      termStates: [
        termState('2026-fall', 'registrable'),
        termState('2026-spring', 'active'),
        termState('2025-fall'),
        termState('2025-spring'),
        termState('2025-summer'),
        termState('2025-winter'),
        termState('2026-summer', 'historical'),
        termState('2026-winter', 'historical'),
        termState('2024-fall'),
        termState('2024-spring'),
      ],
    };

    const report = await buildTermRetentionReport(args({ maxRetainedTerms: 4 }), {
      fetcher,
      status,
    });

    expect(report.retained_term_ids).toEqual([
      '2026-fall',
      '2026-spring',
      '2026-summer',
      '2026-winter',
    ]);
    expect(report.dropped_term_ids).toEqual(expect.arrayContaining([
      '2024-fall',
      '2024-spring',
      '2025-fall',
      '2025-spring',
    ]));
    expect(report.terms.find(term => term.term_id === '2026-fall')).toMatchObject({
      pinned: true,
      retention_decision: 'retain',
      retention_reason: 'pinned registrable term',
    });
  });

  it('prioritizes fall and spring over winter and summer inside the same year', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      Winter: 'winter',
      Spring: 'spring',
      Summer: 'summer',
      Fall: 'fall',
    }));

    const report = await buildTermRetentionReport(args({
      fromYear: 2025,
      toYear: 2025,
      maxRetainedTerms: 2,
    }), {
      fetcher,
      status: {
        termStates: [
          termState('2025-winter'),
          termState('2025-spring'),
          termState('2025-summer'),
          termState('2025-fall'),
        ],
      },
    });

    expect(report.retained_term_ids).toEqual(['2025-fall', '2025-spring']);
    expect(report.dropped_term_ids).toEqual(['2025-summer', '2025-winter']);
  });

  it('does not let older fall and spring terms outrank newer winter and summer terms', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Spring: 'spring', Fall: 'fall' }))
      .mockResolvedValueOnce(response({ Winter: 'winter', Summer: 'summer' }));

    const report = await buildTermRetentionReport(args({
      fromYear: 2026,
      toYear: 2027,
      currentYear: 2028,
      currentTerm: 'spring',
      maxRetainedTerms: 2,
    }), {
      fetcher,
      status: {
        termStates: [
          termState('2026-spring'),
          termState('2026-fall'),
          termState('2027-winter'),
          termState('2027-summer'),
        ],
      },
    });

    expect(report.retained_term_ids).toEqual(['2027-summer', '2027-winter']);
    expect(report.dropped_term_ids).toEqual(expect.arrayContaining(['2026-fall', '2026-spring']));
  });

  it('does not fill leftover budget with older tiny terms after a newer candidate stops fitting', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ Fall: 'fall' }))
      .mockResolvedValueOnce(response({ Spring: 'spring', Fall: 'fall' }));

    const report = await buildTermRetentionReport(args({
      fromYear: 2025,
      toYear: 2026,
      currentYear: 2027,
      currentTerm: 'spring',
      targetSizeMb: 0.05,
    }), {
      fetcher,
      status: {
        termStates: [
          sizedTermState('2026-fall', 10, 10),
          sizedTermState('2026-spring', 100_000, 100_000),
          sizedTermState('2025-fall', 10, 10),
        ],
      },
    });

    expect(report.retained_term_ids).toEqual(['2026-fall']);
    expect(report.dropped_term_ids).toEqual(['2026-spring', '2025-fall']);
  });

  it('orders pinned registrable terms before retained historical terms in output artifacts', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      Spring: 'spring',
      Summer: 'summer',
      Fall: 'fall',
    }));

    const report = await buildTermRetentionReport(args({
      fromYear: 2026,
      toYear: 2026,
      maxRetainedTerms: 3,
    }), {
      fetcher,
      status: {
        termStates: [
          termState('2026-spring'),
          termState('2026-summer', 'registrable'),
          termState('2026-fall', 'registrable'),
        ],
      },
    });

    expect(report.retained_term_ids).toEqual(['2026-fall', '2026-summer', '2026-spring']);
    expect(formatTermRetentionReport(report).indexOf('2026-fall')).toBeLessThan(
      formatTermRetentionReport(report).indexOf('2026-spring')
    );
  });

  it('generates prune SQL that deletes all term-local course data and verifies absence', () => {
    const rows: TermRetentionRow[] = [
      {
        year: 2025,
        term: 'fall',
        term_id: '2025-fall',
        expected_status: 'historical',
        present: true,
        stored_status: 'historical',
        courses_count: 10,
        sections_count: 20,
        last_synced: 1,
        pinned: false,
        estimated_bytes: 1,
        retention_decision: 'retain',
        retention_reason: 'within rolling full-detail retention budget',
      },
      {
        year: 2004,
        term: 'spring',
        term_id: '2004-spring',
        expected_status: 'historical',
        present: true,
        stored_status: 'historical',
        courses_count: 10,
        sections_count: 20,
        last_synced: 1,
        pinned: false,
        estimated_bytes: 1,
        retention_decision: 'drop',
        retention_reason: 'oldest term outside rolling full-detail retention budget',
      },
    ];

    const sql = generatePruneSql(rows);

    expect(sql).toContain('DELETE FROM meeting_instructors');
    expect(sql).toContain('DELETE FROM meetings');
    expect(sql).toContain('DELETE FROM instructor_course_links');
    expect(sql).toContain('DELETE FROM course_gened');
    expect(sql).toContain("DELETE FROM sections WHERE term_id IN ('2004-spring')");
    expect(sql).toContain("DELETE FROM courses WHERE (year = 2004 AND term = 'spring')");
    expect(sql).toContain("DELETE FROM sync_state WHERE id LIKE 'course-sync:2004-spring:%'");
    expect(sql).toContain("SELECT 'dropped_term_state'");
  });

  it('formats a readable markdown report', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ Fall: 'fall' }));
    const report = await buildTermRetentionReport(args({ fromYear: 2025, toYear: 2025 }), {
      fetcher,
      status: { termStates: [termState('2025-fall')] },
    });

    expect(formatTermRetentionReport(report)).toContain('# Term Retention Plan');
    expect(formatTermRetentionReport(report)).toContain('Retained terms: 1');
  });
});
