import { describe, expect, it, vi } from 'vitest';
import {
  formatTermBackfillReport,
  parseBackfillArgs,
  runTermBackfill,
  type BackfillArgs,
} from '../term-backfill.ts';

function args(overrides: Partial<BackfillArgs> = {}): BackfillArgs {
  return {
    year: 2025,
    term: 'fall',
    status: 'historical',
    pageSize: 5,
    startOffset: 0,
    dryRun: false,
    database: 'course-search-db-staging',
    backupRef: '20260602T120000Z',
    evidenceFile: 'evidence.md',
    restoreVerified: true,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('term backfill runner', () => {
  it('parses operator flags', () => {
    expect(parseBackfillArgs([
      '--year', '2025',
      '--term', 'fall',
      '--status', 'historical',
      '--page-size', '3',
      '--start-offset', '6',
      '--max-pages', '2',
      '--output', 'artifacts/backfill/report.json',
      '--backup-ref', '20260602T120000Z',
      '--evidence-file', 'evidence.md',
      '--restore-verified',
      '--dry-run',
    ])).toMatchObject({
      year: 2025,
      term: 'fall',
      status: 'historical',
      pageSize: 3,
      startOffset: 6,
      maxPages: 2,
      output: 'artifacts/backfill/report.json',
      backupRef: '20260602T120000Z',
      evidenceFile: 'evidence.md',
      restoreVerified: true,
      dryRun: true,
    });
  });

  it('dry-runs without staging credentials or backup evidence', async () => {
    const report = await runTermBackfill(args({
      dryRun: true,
      backupRef: undefined,
      evidenceFile: undefined,
      restoreVerified: false,
    }), {
      env: {},
      validateBackupEvidence: vi.fn(),
    });

    expect(report.dry_run).toBe(true);
    expect(report.pages[0].warnings).toContain('dry run: no remote sync request sent');
  });

  it('requires backup evidence before non-dry-run backfill', async () => {
    await expect(runTermBackfill(args({ backupRef: undefined }), {
      env: {
        STAGING_API_BASE_URL: 'https://staging.example.test',
        STAGING_ADMIN_TOKEN: 'admin-token',
      },
    })).rejects.toThrow('Missing D1 backup preflight requirements: --backup-ref');
  });

  it('posts paginated sync requests until the term is complete', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        successfulSubjects: 5,
        failedSubjects: 0,
        totalCourses: 100,
        totalSections: 250,
        rateLimitHits: 0,
        pagination: { total: 8, offset: 0, limit: 5, hasMore: true },
      }))
      .mockResolvedValueOnce(response({
        successfulSubjects: 3,
        failedSubjects: 0,
        totalCourses: 50,
        totalSections: 125,
        rateLimitHits: 1,
        pagination: { total: 8, offset: 5, limit: 5, hasMore: false },
      }));
    const validateBackupEvidence = vi.fn(async () => {});

    const report = await runTermBackfill(args(), {
      env: {
        STAGING_API_BASE_URL: 'https://staging.example.test',
        STAGING_ADMIN_TOKEN: 'admin-token',
      },
      fetcher,
      validateBackupEvidence,
    });

    expect(validateBackupEvidence).toHaveBeenCalledWith(expect.objectContaining({
      database: 'course-search-db-staging',
      backupRef: '20260602T120000Z',
      restoreVerified: true,
    }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstRequest = fetcher.mock.calls[0][0] as Request;
    const secondRequest = fetcher.mock.calls[1][0] as Request;
    expect(firstRequest.url).toBe('https://staging.example.test/admin/sync/2025/fall?offset=0&limit=5&status=historical');
    expect(firstRequest.headers.get('Authorization')).toBe('Bearer admin-token');
    expect(secondRequest.url).toBe('https://staging.example.test/admin/sync/2025/fall?offset=5&limit=5&status=historical');
    expect(report.totals).toEqual({
      successfulSubjects: 8,
      failedSubjects: 0,
      courses: 150,
      sections: 375,
      rateLimitHits: 1,
    });
    expect(report.next_offset).toBeNull();
    expect(report.stopped_early).toBe(false);
  });

  it('honors max-pages and reports the resume offset', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      successfulSubjects: 5,
      failedSubjects: 0,
      totalCourses: 100,
      totalSections: 250,
      pagination: { total: 20, offset: 10, limit: 5, hasMore: true },
    }));

    const report = await runTermBackfill(args({ startOffset: 10, maxPages: 1 }), {
      env: {
        STAGING_API_BASE_URL: 'https://staging.example.test',
        STAGING_ADMIN_TOKEN: 'admin-token',
      },
      fetcher,
      validateBackupEvidence: vi.fn(async () => {}),
    });

    expect(report.stopped_early).toBe(true);
    expect(report.next_offset).toBe(15);
  });

  it('formats readable markdown evidence', async () => {
    const report = await runTermBackfill(args({ dryRun: true }), { env: {} });
    const markdown = formatTermBackfillReport(report);

    expect(markdown).toContain('Term: 2025-fall');
    expect(markdown).toContain('Dry run: yes');
    expect(markdown).toContain('Next offset: 5');
    expect(markdown).toContain('offset 0');
  });
});
