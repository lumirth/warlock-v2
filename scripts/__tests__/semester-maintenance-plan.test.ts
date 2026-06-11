import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatSemesterMaintenanceReport,
  parseSemesterMaintenanceArgs,
  runSemesterMaintenancePlan,
  type SemesterMaintenanceArgs,
} from '../semester-maintenance-plan.ts';

let tempRoot: string | undefined;

function makeTempDir(): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'semester-plan-test-'));
  return tempRoot;
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function args(overrides: Partial<SemesterMaintenanceArgs> = {}): SemesterMaintenanceArgs {
  return {
    outputDir: join(makeTempDir(), 'maintenance'),
    apiBaseUrl: 'https://staging.example.test',
    adminToken: 'test-token',
    fromYear: 2025,
    toYear: 2026,
    frontendBase: 'https://courses.example.test',
    targetSizeMb: 250,
    noFeedback: true,
    feedbackDatabase: 'course-search-db-staging',
    feedbackLimit: 50,
    feedbackRemote: true,
    requireRmp: true,
    ...overrides,
  };
}

function syncStatus(): Record<string, unknown> {
  const lastSync = 1_780_370_000;
  return {
    syncStates: [
      { id: 'gpa', last_sync: lastSync, last_status: 'complete' },
      { id: 'rmp', last_sync: lastSync, last_status: 'complete' },
      { id: 'course-sync:2025-fall:CS', last_status: 'complete' },
      { id: 'course-sync:2025-fall:MATH', last_status: 'complete' },
      { id: 'course-sync:2026-spring:CS', last_status: 'complete' },
      { id: 'course-sync:2026-spring:MATH', last_status: 'complete' },
      { id: 'course-sync:2026-summer:CS', last_status: 'complete' },
      { id: 'course-sync:2026-summer:MATH', last_status: 'complete' },
      { id: 'course-sync:2026-fall:CS', last_status: 'complete' },
      { id: 'course-sync:2026-fall:MATH', last_status: 'complete' },
    ],
    termStates: [
      {
        term_id: '2025-fall',
        year: 2025,
        term: 'fall',
        status: 'historical',
        subjects_count: 2,
        courses_count: 100,
        sections_count: 220,
        last_synced: lastSync,
      },
      {
        term_id: '2026-spring',
        year: 2026,
        term: 'spring',
        status: 'historical',
        subjects_count: 2,
        courses_count: 100,
        sections_count: 220,
        last_synced: lastSync,
      },
      {
        term_id: '2026-summer',
        year: 2026,
        term: 'summer',
        status: 'registrable',
        subjects_count: 2,
        courses_count: 100,
        sections_count: 220,
        last_synced: lastSync,
      },
      {
        term_id: '2026-fall',
        year: 2026,
        term: 'fall',
        status: 'registrable',
        subjects_count: 2,
        courses_count: 100,
        sections_count: 220,
        last_synced: lastSync,
      },
    ],
    enrichmentCoverage: [
      { term_id: '2026-summer', courses_with_gpa: 10, courses_with_quality: 20, courses_with_difficulty: 20, enriched_links: 30 },
      { term_id: '2026-fall', courses_with_gpa: 10, courses_with_quality: 20, courses_with_difficulty: 20, enriched_links: 30 },
    ],
    freshness: {
      currentTermId: '2026-fall',
      configuredCurrentTermId: '2026-fall',
      currentTermPresent: true,
      registrableTermIds: ['2026-fall', '2026-summer'],
      activeTermIds: ['2026-fall', '2026-summer'],
      upcomingTermIds: ['2026-fall'],
      historicalTermCount: 2,
      staleTermIds: [],
      staleSyncStateIds: [],
    },
  };
}

function termlistFetcher() {
  return vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === '/admin/sync/status') {
      expect(request.headers.get('Authorization')).toBe('Bearer test-token');
      return response(syncStatus());
    }
    if (url.pathname.endsWith('/ajax/search/termlist/2025')) {
      return response({ Fall: 'fall' });
    }
    if (url.pathname.endsWith('/ajax/search/termlist/2026')) {
      return response({ Spring: 'spring', Summer: 'summer', Fall: 'fall' });
    }
    return response({ error: 'not found' }, 404);
  });
}

describe('semester maintenance plan', () => {
  it('parses operator flags', () => {
    expect(parseSemesterMaintenanceArgs([
      '--output-dir', 'artifacts/semester-maintenance/test',
      '--status-input', 'artifacts/sync-status.json',
      '--from-year', '2024',
      '--to-year', '2027',
      '--frontend-base', 'https://courses.example.test',
      '--target-size-mb', '125.5',
      '--max-retained-terms', '12',
      '--no-feedback',
      '--feedback-database', 'course-search-db-preview',
      '--feedback-limit', '25',
      '--feedback-local',
      '--no-require-rmp',
    ])).toMatchObject({
      outputDir: 'artifacts/semester-maintenance/test',
      statusInput: 'artifacts/sync-status.json',
      fromYear: 2024,
      toYear: 2027,
      frontendBase: 'https://courses.example.test',
      targetSizeMb: 125.5,
      maxRetainedTerms: 12,
      noFeedback: true,
      feedbackDatabase: 'course-search-db-preview',
      feedbackLimit: 25,
      feedbackRemote: false,
      requireRmp: false,
    });
  });

  it('rejects malformed and out-of-range operator numbers', () => {
    expect(() => parseSemesterMaintenanceArgs(['--from-year', '2026.5']))
      .toThrow('--from-year must be a non-negative integer');
    expect(() => parseSemesterMaintenanceArgs(['--target-size-mb', '-1']))
      .toThrow('--target-size-mb must be a non-negative number');
    expect(() => parseSemesterMaintenanceArgs(['--feedback-limit', '1001']))
      .toThrow('--feedback-limit must be between 1 and 1000');
  });

  it('writes a read-only maintenance bundle from live status and retained-term planning', async () => {
    const report = await runSemesterMaintenancePlan(args(), {
      fetcher: termlistFetcher(),
      now: new Date('2026-06-03T02:00:00Z'),
    });

    expect(report.status_source).toBe('https://staging.example.test/admin/sync/status');
    expect(report.counts).toMatchObject({
      retained_terms: 4,
      dropped_terms: 0,
      coverage_terms_needing_backfill: 0,
      freshness_failed_checks: 0,
      feedback_rows: null,
      feedback_candidates: null,
    });
    expect(report.gates.every(gate => gate.ok)).toBe(true);
    expect(readFileSync(report.artifacts.status, 'utf8')).toContain('"currentTermId": "2026-fall"');
    expect(readFileSync(report.artifacts.retentionMarkdown, 'utf8')).toContain('2026-fall (registrable)');
    expect(readFileSync(report.artifacts.coverageMarkdown, 'utf8')).toContain('Terms needing backfill: 0');
    expect(readFileSync(report.artifacts.freshnessMarkdown, 'utf8')).toContain('PASS active/registrable enrichment coverage');
    expect(readFileSync(report.artifacts.summary, 'utf8')).toContain('Overall: ready');
  });

  it('does not raise next actions for feedback candidates already covered by the resolution ledger', async () => {
    const runner = vi.fn(async () => JSON.stringify([
      {
        results: [
          {
            id: 'feedback-1',
            kind: 'search_results',
            issue: 'expected_different_results',
            page: 'search',
            query: 'professor fagen algorithms',
            expected: 'CS algorithms taught by Fagen',
            created_at: 1780370000,
          },
        ],
      },
    ]));
    const report = await runSemesterMaintenancePlan(args({ noFeedback: false }), {
      fetcher: termlistFetcher(),
      commandRunner: runner,
      now: new Date('2026-06-03T02:00:00Z'),
    });

    expect(runner).toHaveBeenCalledWith('npx', expect.arrayContaining(['wrangler', 'd1', 'execute', 'course-search-db-staging']));
    expect(report.counts.feedback_rows).toBe(1);
    expect(report.counts.feedback_candidates).toBe(0);
    expect(report.next_actions).not.toContain('Review generated feedback candidates and promote accepted items into evals, score audits, link audits, or copy audits.');
    expect(readFileSync(report.artifacts.feedbackCandidates!, 'utf8')).toContain('"candidate_count": 1');
    expect(readFileSync(report.artifacts.feedbackCandidates!, 'utf8')).toContain('"needs_review_count": 0');
  });

  it('does not request prune backup work when dropped terms are already absent', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/admin/sync/status') {
        const lastSync = 1_780_370_000;
        return response({
          syncStates: [
            { id: 'gpa', last_sync: lastSync, last_status: 'complete' },
            { id: 'rmp', last_sync: lastSync, last_status: 'complete' },
            { id: 'course-sync:2026-summer:CS', last_status: 'complete' },
            { id: 'course-sync:2026-summer:MATH', last_status: 'complete' },
            { id: 'course-sync:2026-fall:CS', last_status: 'complete' },
            { id: 'course-sync:2026-fall:MATH', last_status: 'complete' },
          ],
          termStates: [
            {
              term_id: '2026-summer',
              year: 2026,
              term: 'summer',
              status: 'registrable',
              subjects_count: 2,
              courses_count: 100,
              sections_count: 220,
              last_synced: lastSync,
            },
            {
              term_id: '2026-fall',
              year: 2026,
              term: 'fall',
              status: 'registrable',
              subjects_count: 2,
              courses_count: 100,
              sections_count: 220,
              last_synced: lastSync,
            },
          ],
          enrichmentCoverage: [
            { term_id: '2026-summer', courses_with_gpa: 10, courses_with_quality: 20, courses_with_difficulty: 20, enriched_links: 30 },
            { term_id: '2026-fall', courses_with_gpa: 10, courses_with_quality: 20, courses_with_difficulty: 20, enriched_links: 30 },
          ],
          freshness: {
            currentTermId: '2026-fall',
            currentTermPresent: true,
            registrableTermIds: ['2026-fall', '2026-summer'],
            activeTermIds: ['2026-fall', '2026-summer'],
            upcomingTermIds: ['2026-fall'],
            historicalTermCount: 1,
            staleTermIds: [],
            staleSyncStateIds: [],
          },
        });
      }
      if (url.pathname.endsWith('/ajax/search/termlist/2025')) {
        return response({ Fall: 'fall' });
      }
      if (url.pathname.endsWith('/ajax/search/termlist/2026')) {
        return response({ Spring: 'spring', Summer: 'summer', Fall: 'fall' });
      }
      return response({ error: 'not found' }, 404);
    });

    const report = await runSemesterMaintenancePlan(args({
      maxRetainedTerms: 2,
    }), {
      fetcher,
      now: new Date('2026-06-03T02:00:00Z'),
    });

    expect(report.counts.dropped_terms).toBeGreaterThan(0);
    expect(report.backup_required_before_prune).toBe(false);
    expect(report.next_actions).not.toContain('Create and restore-verify a D1 Time Travel backup before executing the generated prune SQL remotely.');
    expect(formatSemesterMaintenanceReport(report)).toContain('Overall: ready');
  });

  it('surfaces backfill, freshness, and feedback failures as gates instead of hiding them', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/admin/sync/status') {
        return response({
          ...syncStatus(),
          termStates: [],
          enrichmentCoverage: [],
          freshness: {
            currentTermId: '2026-fall',
            currentTermPresent: false,
            registrableTermIds: [],
            activeTermIds: [],
            upcomingTermIds: [],
            historicalTermCount: 0,
            staleTermIds: ['2026-fall'],
            staleSyncStateIds: ['gpa', 'rmp'],
          },
        });
      }
      if (url.pathname.endsWith('/ajax/search/termlist/2026')) {
        return response({ Fall: 'fall' });
      }
      return response({}, 200);
    });

    const report = await runSemesterMaintenancePlan(args({
      fromYear: 2026,
      toYear: 2026,
      noFeedback: false,
    }), {
      fetcher,
      commandRunner: vi.fn(async () => {
        throw new Error('wrangler unavailable');
      }),
      now: new Date('2026-06-03T02:00:00Z'),
    });

    expect(report.gates.filter(gate => !gate.ok).map(gate => gate.name)).toEqual([
      'retained term coverage',
      'freshness audit',
      'feedback export',
    ]);
    expect(formatSemesterMaintenanceReport(report)).toContain('Overall: needs operator action');
    expect(report.next_actions.join('\n')).toContain('Use the generated coverage report backfill commands');
    expect(report.next_actions.join('\n')).toContain('Fix the feedback export failure');
  });
});
