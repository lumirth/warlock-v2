import { describe, expect, it, vi } from 'vitest';
import {
  formatCoverageBackfillReport,
  parseCoverageBackfillArgs,
  runCoverageBackfill,
  type CoverageBackfillArgs,
} from '../term-coverage-backfill.ts';

function args(overrides: Partial<CoverageBackfillArgs> = {}): CoverageBackfillArgs {
  return {
    coveragePlan: 'artifacts/term-coverage-plan.json',
    pageSize: 5,
    dryRun: false,
    forceRunningLocks: false,
    database: 'course-search-db-staging',
    backupRef: '20260602T120000Z',
    evidenceFile: 'evidence.md',
    restoreVerified: true,
    ...overrides,
  };
}

function coveragePlan() {
  return {
    terms: [
      {
        term_id: '2025-fall',
        year: 2025,
        term: 'fall' as const,
        expected_status: 'historical' as const,
        reason: 'missing from term_state',
        needs_backfill: true,
      },
      {
        term_id: '2026-spring',
        year: 2026,
        term: 'spring' as const,
        expected_status: 'active' as const,
        reason: 'covered',
        needs_backfill: false,
      },
      {
        term_id: '2026-fall',
        year: 2026,
        term: 'fall' as const,
        expected_status: 'active' as const,
        reason: 'missing from term_state',
        needs_backfill: true,
      },
    ],
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('coverage backfill runner', () => {
  it('parses operator flags', () => {
    expect(parseCoverageBackfillArgs([
      '--coverage-plan', 'artifacts/term-coverage-plan.json',
      '--page-size', '3',
      '--max-terms', '2',
      '--max-pages-per-term', '1',
      '--output', 'artifacts/coverage-backfill.json',
      '--database', 'course-search-db-staging',
      '--backup-ref', '20260602T120000Z',
      '--evidence-file', 'evidence.md',
      '--restore-verified',
      '--dry-run',
      '--force-running-locks',
    ])).toMatchObject({
      coveragePlan: 'artifacts/term-coverage-plan.json',
      pageSize: 3,
      maxTerms: 2,
      maxPagesPerTerm: 1,
      output: 'artifacts/coverage-backfill.json',
      backupRef: '20260602T120000Z',
      evidenceFile: 'evidence.md',
      restoreVerified: true,
      dryRun: true,
      forceRunningLocks: true,
    });
  });

  it('dry-runs selected backfill terms without credentials or backup evidence', async () => {
    const report = await runCoverageBackfill(args({
      dryRun: true,
      maxTerms: 1,
      backupRef: undefined,
      evidenceFile: undefined,
      restoreVerified: false,
    }), {
      coveragePlan: coveragePlan(),
      env: {},
      validateBackupEvidence: vi.fn(),
    });

    expect(report.target_count).toBe(2);
    expect(report.executed_count).toBe(1);
    expect(report.terms[0]).toMatchObject({
      term_id: '2025-fall',
      status: 'historical',
      next_offset: 5,
    });
  });

  it('validates backup evidence once before running remote term backfills', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        successfulSubjects: 5,
        failedSubjects: 0,
        totalCourses: 100,
        totalSections: 250,
        pagination: { total: 5, offset: 0, limit: 5, hasMore: false },
      }))
      .mockResolvedValueOnce(response({
        successfulSubjects: 5,
        failedSubjects: 0,
        totalCourses: 80,
        totalSections: 220,
        pagination: { total: 9, offset: 0, limit: 5, hasMore: true },
      }));
    const validateBackupEvidence = vi.fn(async () => {});
    const writePartialReport = vi.fn();

    const report = await runCoverageBackfill(args({ maxPagesPerTerm: 1 }), {
      coveragePlan: coveragePlan(),
      env: {
        STAGING_API_BASE_URL: 'https://staging.example.test',
        STAGING_ADMIN_TOKEN: 'admin-token',
      },
      fetcher,
      validateBackupEvidence,
      writePartialReport,
    });

    expect(validateBackupEvidence).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((fetcher.mock.calls[0][0] as Request).url).toBe('https://staging.example.test/admin/sync/2025/fall?offset=0&limit=5&status=historical');
    expect((fetcher.mock.calls[1][0] as Request).url).toBe('https://staging.example.test/admin/sync/2026/fall?offset=0&limit=5&status=active');
    expect(report.target_count).toBe(2);
    expect(report.executed_count).toBe(2);
    expect(report.incomplete_count).toBe(1);
    expect(report.failed_subjects).toBe(0);
    expect(report.skipped_subjects).toBe(0);
    expect(writePartialReport).toHaveBeenCalledTimes(2);
    expect(writePartialReport).toHaveBeenLastCalledWith(expect.objectContaining({
      executed_count: 2,
      incomplete_count: 1,
    }));
  });

  it('treats skipped subject locks as incomplete coverage', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      subjectResults: [
        { subject: 'CS', success: true, skipped: true },
      ],
      successfulSubjects: 1,
      failedSubjects: 0,
      totalCourses: 0,
      totalSections: 0,
      pagination: { total: 1, offset: 0, limit: 5, hasMore: false },
    }));

    const report = await runCoverageBackfill(args({ maxTerms: 1 }), {
      coveragePlan: coveragePlan(),
      env: {
        STAGING_API_BASE_URL: 'https://staging.example.test',
        STAGING_ADMIN_TOKEN: 'admin-token',
      },
      fetcher,
      validateBackupEvidence: vi.fn(async () => {}),
    });

    expect(report.incomplete_count).toBe(1);
    expect(report.skipped_subjects).toBe(1);
    expect(report.terms[0].complete).toBe(false);
  });

  it('formats aggregate markdown evidence', async () => {
    const report = await runCoverageBackfill(args({ dryRun: true }), {
      coveragePlan: coveragePlan(),
      env: {},
    });

    const markdown = formatCoverageBackfillReport(report);

    expect(markdown).toContain('# Coverage Backfill Report');
    expect(markdown).toContain('Target terms: 2');
    expect(markdown).toContain('2025-fall (historical)');
    expect(markdown).toContain('2026-fall (active)');
  });
});
