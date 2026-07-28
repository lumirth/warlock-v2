import { describe, expect, it, vi } from 'vitest';
import {
  assertCourseSyncStatus,
  assertFullCourseSyncResult,
  assertTermDiscoveryResult,
  latestMigrationName,
  latestMigrationSha256,
  productionDatabaseFromWrangler,
  productionReleaseConfig,
  rebuildRegenerableData,
  releaseCommands,
  releaseTargetFromArgv,
  requestGpaChunkWithRetry,
  stagingReleaseConfig,
  syncGpaUntilComplete,
  syncReleaseTermsInPages,
} from '../staging-api-release.js';

const validEnv = {
  STAGING_API_BASE_URL: 'https://uiuc-course-search-staging.lumirth.workers.dev',
  STAGING_ADMIN_TOKEN: 'secret-admin-token',
  STAGING_MIGRATION_APPROVED: latestMigrationName(),
  STAGING_MIGRATION_SHA256_APPROVED: latestMigrationSha256(),
  D1_BACKUP_REF: '20260728T010203Z',
  D1_BACKUP_EVIDENCE_FILE: 'artifacts/d1-backup-evidence.md',
};

const validProductionEnv = {
  PRODUCTION_API_BASE_URL: 'https://uiuc-course-search.lumirth.workers.dev',
  PRODUCTION_ADMIN_TOKEN: 'secret-production-admin-token',
  PRODUCTION_MIGRATION_APPROVED: latestMigrationName(),
  PRODUCTION_MIGRATION_SHA256_APPROVED: latestMigrationSha256(),
  PRODUCTION_D1_BACKUP_REF: '20260728T020304Z',
  PRODUCTION_D1_BACKUP_EVIDENCE_FILE:
    'artifacts/production-d1-backup-evidence.md',
};

const productionWranglerConfig = `
name = "uiuc-course-search"

[[d1_databases]]
binding = "DB"
database_name = "course-search-db-v2"
database_id = "00000000-0000-0000-0000-000000000002"

[env.staging]
[[env.staging.d1_databases]]
binding = "DB"
database_name = "course-search-db-staging"
`;

describe('staging API release', () => {
  it('requires explicit approval of the current migration', () => {
    const latestMigration = latestMigrationName();
    expect(latestMigration).toMatch(/^\d+_.+/);
    expect(() => stagingReleaseConfig({
      ...validEnv,
      STAGING_MIGRATION_APPROVED: '0000_not_current',
    })).toThrow(`must equal the current migration ${latestMigration}`);
  });

  it('binds migration approval to the exact current file contents', () => {
    const latestMigration = latestMigrationName();
    expect(latestMigrationSha256()).toMatch(/^[a-f0-9]{64}$/);
    expect(() => stagingReleaseConfig({
      ...validEnv,
      STAGING_MIGRATION_SHA256_APPROVED: '0'.repeat(64),
    })).toThrow(`must equal the SHA-256 of ${latestMigration}.sql`);

    const {
      STAGING_MIGRATION_SHA256_APPROVED: _approvedSha256,
      ...withoutApprovedSha256
    } = validEnv;
    expect(() => stagingReleaseConfig(withoutApprovedSha256)).toThrow(
      /STAGING_MIGRATION_SHA256_APPROVED is required/,
    );
  });

  it('rejects missing backup evidence before producing a release plan', () => {
    const { D1_BACKUP_REF: _backupRef, ...withoutBackup } = validEnv;
    expect(() => stagingReleaseConfig(withoutBackup)).toThrow(
      /D1_BACKUP_REF is required/,
    );
  });

  it('orders backup verification, migration, and Worker deployment safely', () => {
    const config = stagingReleaseConfig(validEnv);
    const commands = releaseCommands(config);
    const labels = commands.map(command => command.label);

    expect(labels).toEqual([
      'API checks',
      'schema verification',
      'restore-tested D1 backup gate',
      `apply ${latestMigrationName()}`,
      'deploy staging Worker',
    ]);
    expect(commands[2].args).toContain('--restore-verified');
    expect(commands[3].args).toEqual([
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'course-search-db-staging',
      '--env',
      'staging',
      '--remote',
    ]);
    expect(commands[4].args).toEqual([
      'wrangler',
      'deploy',
      '--env',
      'staging',
    ]);
  });

  it('rejects a non-HTTPS or non-staging target', () => {
    expect(() => stagingReleaseConfig({
      ...validEnv,
      STAGING_API_BASE_URL: 'http://localhost:8787',
    })).toThrow(/must be exactly/);
  });

  it('refuses to send the admin token to an arbitrary host containing staging', () => {
    expect(() => stagingReleaseConfig({
      ...validEnv,
      STAGING_API_BASE_URL: 'https://staging.attacker.example',
    })).toThrow(/must be exactly/);
  });

  it('accepts only an all-term successful full course rebuild', () => {
    expect(assertFullCourseSyncResult({
      termCount: 2,
      failedTermCount: 0,
      results: [
        {
          termId: '2026-spring',
          subjectCount: 180,
          failedBatchCount: 0,
          failedSubjectCount: 0,
          skippedSubjectCount: 0,
          success: true,
        },
        {
          termId: '2026-fall',
          subjectCount: 187,
          failedBatchCount: 0,
          failedSubjectCount: 0,
          skippedSubjectCount: 0,
          success: true,
        },
      ],
    })).toEqual(['2026-spring', '2026-fall']);

    expect(() => assertFullCourseSyncResult({
      termCount: 1,
      failedTermCount: 1,
      results: [{
        termId: '2026-fall',
        subjectCount: 187,
        failedBatchCount: 1,
        failedSubjectCount: 1,
        skippedSubjectCount: 0,
        success: false,
      }],
    })).toThrow(/did not complete every term/);
  });

  it('requires durable complete term and subject state after a full rebuild', () => {
    expect(() => assertCourseSyncStatus({
      termStates: [{
        term_id: '2026-fall',
        last_synced: 1_800_000_000,
        subjects_count: 1,
        sync_errors: null,
      }],
      subjectSyncStates: [{
        term_id: '2026-fall',
        subject: 'CS',
        status: 'complete',
      }],
    }, ['2026-fall'])).not.toThrow();

    expect(() => assertCourseSyncStatus({
      termStates: [{
        term_id: '2026-fall',
        last_synced: 1_800_000_000,
        subjects_count: 1,
        sync_errors: null,
      }],
      subjectSyncStates: [{
        term_id: '2026-fall',
        subject: 'CS',
        status: 'failed',
      }],
    }, ['2026-fall'])).toThrow(/subject sync status is incomplete/);
  });
});

describe('production API release', () => {
  it('requires production-specific credentials, approvals, and backup evidence', () => {
    const config = productionReleaseConfig(
      validProductionEnv,
      productionWranglerConfig,
    );

    expect(config.target).toBe('production');
    expect(config.apiBaseUrl).toBe(
      'https://uiuc-course-search.lumirth.workers.dev',
    );
    expect(config.database).toBe('course-search-db-v2');
    expect(config.workerName).toBe('uiuc-course-search');

    expect(() => productionReleaseConfig({
      ...validProductionEnv,
      PRODUCTION_D1_BACKUP_REF: undefined,
      D1_BACKUP_REF: '20260728T030405Z',
      D1_BACKUP_EVIDENCE_FILE: 'artifacts/staging-only.md',
    }, productionWranglerConfig)).toThrow(
      /PRODUCTION_D1_BACKUP_REF is required/,
    );

    expect(() => productionReleaseConfig({
      ...validProductionEnv,
      PRODUCTION_MIGRATION_APPROVED: undefined,
      STAGING_MIGRATION_APPROVED: latestMigrationName(),
    }, productionWranglerConfig)).toThrow(
      /PRODUCTION_MIGRATION_APPROVED is required/,
    );

    expect(() => productionReleaseConfig({
      ...validProductionEnv,
      PRODUCTION_ADMIN_TOKEN: undefined,
      STAGING_ADMIN_TOKEN: 'staging-token-is-not-production-authorization',
    }, productionWranglerConfig)).toThrow(
      /PRODUCTION_ADMIN_TOKEN is required/,
    );

    expect(() => productionReleaseConfig({
      ...validProductionEnv,
      PRODUCTION_D1_BACKUP_EVIDENCE_FILE: undefined,
      D1_BACKUP_EVIDENCE_FILE: 'artifacts/staging-only.md',
    }, productionWranglerConfig)).toThrow(
      /PRODUCTION_D1_BACKUP_EVIDENCE_FILE is required/,
    );
  });

  it('refuses to migrate the legacy over-limit production database', () => {
    expect(() => productionDatabaseFromWrangler(`
      [[d1_databases]]
      binding = "DB"
      database_name = "course-search-db"
    `)).toThrow(/legacy course-search-db is rollback-only/);

    expect(() => productionDatabaseFromWrangler(
      productionWranglerConfig,
    )).not.toThrow();
    expect(productionDatabaseFromWrangler()).toBe('course-search-db-v2');
  });

  it('rejects every API URL except the exact official production host', () => {
    for (const apiBaseUrl of [
      'http://uiuc-course-search.lumirth.workers.dev',
      'https://uiuc-course-search-staging.lumirth.workers.dev',
      'https://uiuc-course-search.lumirth.workers.dev.attacker.example',
      'https://uiuc-course-search.lumirth.workers.dev/admin',
    ]) {
      expect(() => productionReleaseConfig({
        ...validProductionEnv,
        PRODUCTION_API_BASE_URL: apiBaseUrl,
      }, productionWranglerConfig)).toThrow(
        'PRODUCTION_API_BASE_URL must be exactly '
        + 'https://uiuc-course-search.lumirth.workers.dev.',
      );
    }
  });

  it('targets only the official production D1 database and Worker', () => {
    const commands = releaseCommands(
      productionReleaseConfig(validProductionEnv, productionWranglerConfig),
    );

    expect(commands.map(command => command.label)).toEqual([
      'API checks',
      'schema verification',
      'restore-tested D1 backup gate',
      `apply ${latestMigrationName()}`,
      'deploy production Worker',
    ]);
    expect(commands[2].args).toContain('course-search-db-v2');
    expect(commands[3].args).toEqual([
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'course-search-db-v2',
      '--remote',
    ]);
    expect(commands[4].args).toEqual([
      'wrangler',
      'deploy',
      '--name',
      'uiuc-course-search',
    ]);
    expect(commands.flatMap(command => command.args)).not.toContain('staging');
    expect(commands.flatMap(command => command.args)).not.toContain(
      'course-search-db',
    );
  });

  it('selects production only through an explicit valid target argument', () => {
    expect(releaseTargetFromArgv([])).toBe('staging');
    expect(releaseTargetFromArgv(['--target', 'production'])).toBe(
      'production',
    );
    expect(() => releaseTargetFromArgv(['production'])).toThrow(/Usage/);
    expect(() => releaseTargetFromArgv(['--target', 'prod'])).toThrow(/Usage/);
  });
});

describe('release paged term sync', () => {
  const term = {
    termId: '2026-fall',
    year: 2026,
    term: 'fall' as const,
    status: 'active' as const,
    sampleStatuses: ['Open'],
  };

  it('serializes bounded pages and finalizes only after exact coverage', async () => {
    const subjects = ['CS', 'MATH', 'STAT', 'PHYS', 'CHEM', 'ENGL'];
    const request = vi.fn(async (_config: unknown, path: string) => {
      if (path.includes('/finalize?since=')) {
        const finalizationUrl = new URL(
          path,
          'https://release.test',
        );
        const since = Number(finalizationUrl.searchParams.get('since'));
        const manifestSha256 = finalizationUrl.searchParams.get(
          'manifestSha256',
        );
        return {
          success: true,
          termId: term.termId,
          year: term.year,
          term: term.term,
          status: term.status,
          subjectCount: subjects.length,
          completeSubjectCount: subjects.length,
          removedSubjectCount: 1,
          deletedCourseCount: 2,
          coursesCount: 60,
          sectionsCount: 120,
          minimumLastSync: since,
          earliestSubjectSync: since,
          manifestSha256,
          lastSynced: since + 1,
        };
      }
      const url = new URL(path, 'https://release.test');
      const offset = Number(url.searchParams.get('offset'));
      const pageSubjects = subjects.slice(offset, offset + 5);
      return termPage(term, pageSubjects, {
        total: subjects.length,
        offset,
        hasMore: offset + 5 < subjects.length,
      });
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(syncReleaseTermsInPages(
        stagingReleaseConfig(validEnv),
        [term],
        request,
      )).resolves.toEqual([expect.objectContaining({
        termId: term.termId,
        subjectCount: subjects.length,
      })]);
    } finally {
      consoleLog.mockRestore();
    }

    expect(request.mock.calls.map(call => call[1])).toEqual([
      '/admin/sync/2026/fall?offset=0&limit=5&force=true&status=active',
      '/admin/sync/2026/fall?offset=5&limit=5&force=true&status=active',
      expect.stringMatching(
        /^\/admin\/sync\/2026\/fall\/finalize\?since=\d+&manifestSha256=[a-f0-9]{64}$/,
      ),
    ]);
  });

  it('fails before finalization on a skipped page subject', async () => {
    const request = vi.fn(async () => {
      const payload = termPage(term, ['CS'], {
        total: 1,
        offset: 0,
        hasMore: false,
      });
      payload.subjectResults[0].skipped = true;
      return payload;
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(syncReleaseTermsInPages(
        stagingReleaseConfig(validEnv),
        [term],
        request,
      )).rejects.toThrow(/failed or skipped subject/);
    } finally {
      consoleLog.mockRestore();
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('release GPA import', () => {
  it('retries transient D1 failures and GPA lease contention', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error(
        'POST /admin/sync-gpa failed with 500: '
        + '{"error":"D1_ERROR: Network connection lost."}',
      ))
      .mockResolvedValueOnce({
        success: false,
        rowsProcessed: 0,
        message: 'GPA sync mutation lease is busy',
        isComplete: false,
        completionKey: null,
      })
      .mockResolvedValueOnce({
        success: true,
        rowsProcessed: 10,
        message: 'Processed 10 rows',
        isComplete: false,
        completionKey: null,
      });
    const sleep = vi.fn(async () => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(requestGpaChunkWithRetry(
        request,
        sleep,
      )).resolves.toMatchObject({
        success: true,
        rowsProcessed: 10,
      });
    } finally {
      consoleWarn.mockRestore();
    }

    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000);
  });

  it('does not retry a non-transient GPA failure', async () => {
    const request = vi.fn().mockRejectedValue(
      new Error('POST /admin/sync-gpa failed with 400: bad request'),
    );
    const sleep = vi.fn(async () => {});

    await expect(requestGpaChunkWithRetry(
      request,
      sleep,
    )).rejects.toThrow(/400: bad request/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('imports every GPA chunk before aggregating and publishing scores', async () => {
    let gpaCalls = 0;
    const request = vi.fn(async (_config: unknown, path: string) => {
      if (path === '/admin/discover-terms') {
        return {
          discovered: 1,
          terms: [{
            termId: '2026-fall',
            year: 2026,
            term: 'fall',
            status: 'active',
            sampleStatuses: ['Open'],
          }],
        };
      }
      if (path.startsWith('/admin/sync/2026/fall?')) {
        return {
          termId: '2026-fall',
          year: 2026,
          term: 'fall',
          subjectResults: [{
            subject: 'CS',
            success: true,
            coursesCount: 10,
            sectionsCount: 20,
            durationMs: 1,
          }],
          totalCourses: 10,
          totalSections: 20,
          successfulSubjects: 1,
          failedSubjects: 0,
          durationMs: 1,
          rateLimitHits: 0,
          pagination: {
            total: 1,
            offset: 0,
            limit: 5,
            hasMore: false,
          },
          forceRunningLocks: true,
          warnings: [],
        };
      }
      if (path.startsWith('/admin/sync/2026/fall/finalize?since=')) {
        const finalizationUrl = new URL(path, 'https://release.test');
        const since = Number(finalizationUrl.searchParams.get('since'));
        const manifestSha256 = finalizationUrl.searchParams.get(
          'manifestSha256',
        );
        return {
          success: true,
          termId: '2026-fall',
          year: 2026,
          term: 'fall',
          status: 'active',
          subjectCount: 1,
          completeSubjectCount: 1,
          removedSubjectCount: 0,
          deletedCourseCount: 0,
          coursesCount: 10,
          sectionsCount: 20,
          minimumLastSync: since,
          earliestSubjectSync: since,
          manifestSha256,
          lastSynced: 1_800_000_000,
        };
      }
      if (path === '/admin/sync-gpa') {
        gpaCalls += 1;
        return gpaCalls === 1
          ? {
              success: true,
              rowsProcessed: 100,
              message: 'Processed 100 rows',
              isComplete: false,
              completionKey: null,
            }
          : {
              success: true,
              rowsProcessed: 20,
              message: 'Processed 20 rows and reached EOF',
              isComplete: true,
              completionKey: '"dataset-v1":12345',
            };
      }
      if (path === '/admin/sync-rmp') return { count: 1 };
      if (path === '/admin/sync/status') {
        return {
          termStates: [{
            term_id: '2026-fall',
            last_synced: 1_800_000_000,
            subjects_count: 1,
            sync_errors: null,
          }],
          subjectSyncStates: [{
            term_id: '2026-fall',
            subject: 'CS',
            status: 'complete',
          }],
        };
      }
      return {};
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await rebuildRegenerableData(stagingReleaseConfig(validEnv), request);
    } finally {
      consoleLog.mockRestore();
    }

    const paths = request.mock.calls.map(call => call[1]);
    expect(paths.slice(0, 3)).toEqual([
      '/health',
      '/admin/discover-terms',
      '/admin/sync/2026/fall?offset=0&limit=5&force=true&status=active',
    ]);
    expect(paths[3]).toMatch(
      /^\/admin\/sync\/2026\/fall\/finalize\?since=\d+&manifestSha256=[a-f0-9]{64}$/,
    );
    expect(paths.slice(4)).toEqual([
      '/admin/sync-gpa',
      '/admin/sync-gpa',
      '/admin/enrich-gpa',
      '/admin/sync-rmp',
      '/admin/sync/status',
    ]);
  });

  it('requests chunks until the importer returns durable completion', async () => {
    const requestChunk = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        rowsProcessed: 250,
        message: 'Processed 250 rows',
        isComplete: false,
        completionKey: null,
      })
      .mockResolvedValueOnce({
        success: true,
        rowsProcessed: 40,
        message: 'Processed 40 rows and reached EOF',
        isComplete: true,
        completionKey: '"dataset-v1":12345',
      });

    await expect(syncGpaUntilComplete(requestChunk)).resolves.toEqual({
      calls: 2,
      rowsProcessed: 290,
      completionKey: '"dataset-v1":12345',
    });
    expect(requestChunk).toHaveBeenCalledTimes(2);
  });

  it('accepts a completed generation as a safe zero-row no-op', async () => {
    await expect(syncGpaUntilComplete(async () => ({
      success: true,
      rowsProcessed: 0,
      message: 'Sync already complete',
      isComplete: true,
      completionKey: '"dataset-v1":12345',
    }))).resolves.toMatchObject({
      calls: 1,
      rowsProcessed: 0,
      completionKey: '"dataset-v1":12345',
    });
  });

  it('fails closed on unsuccessful, invalid, or no-progress chunks', async () => {
    await expect(syncGpaUntilComplete(async () => ({
      success: false,
      rowsProcessed: 0,
      message: 'GPA sync mutation lease is busy',
      isComplete: false,
      completionKey: null,
    }))).rejects.toThrow(/chunk 1 was unsuccessful/);

    await expect(syncGpaUntilComplete(async () => ({
      success: true,
      rowsProcessed: '10',
      message: 'not a valid row count',
      isComplete: false,
      completionKey: null,
    }))).rejects.toThrow(/chunk 1 returned an invalid payload/);

    await expect(syncGpaUntilComplete(async () => ({
      success: true,
      rowsProcessed: 0,
      message: 'cursor did not advance',
      isComplete: false,
      completionKey: null,
    }))).rejects.toThrow(/chunk 1 made no progress/);
  });

  it('requires a completion key and rejects premature completion keys', async () => {
    await expect(syncGpaUntilComplete(async () => ({
      success: true,
      rowsProcessed: 1,
      message: 'reached EOF',
      isComplete: true,
      completionKey: null,
    }))).rejects.toThrow(/completed without a completion key/);

    await expect(syncGpaUntilComplete(async () => ({
      success: true,
      rowsProcessed: 1,
      message: 'still running',
      isComplete: false,
      completionKey: '"too-early":1',
    }))).rejects.toThrow(/premature completion key/);
  });

  it('stops at the bounded call limit', async () => {
    const requestChunk = vi.fn(async () => ({
      success: true,
      rowsProcessed: 1,
      message: 'still running',
      isComplete: false,
      completionKey: null,
    }));

    await expect(syncGpaUntilComplete(requestChunk, 3)).rejects.toThrow(
      /did not complete within 3 chunk requests/,
    );
    expect(requestChunk).toHaveBeenCalledTimes(3);
  });
});

describe('release term discovery gate', () => {
  const validDiscovery = {
    discovered: 3,
    terms: [
      {
        termId: '2026-spring',
        year: 2026,
        term: 'spring',
        status: 'historical',
        sampleStatuses: [],
      },
      {
        termId: '2026-fall',
        year: 2026,
        term: 'fall',
        status: 'active',
        sampleStatuses: ['Closed'],
      },
      {
        termId: '2027-spring',
        year: 2027,
        term: 'spring',
        status: 'registrable',
        sampleStatuses: ['Open'],
      },
    ],
  };

  it('accepts a positive, internally consistent discovery response', () => {
    expect(assertTermDiscoveryResult(validDiscovery).map(
      term => term.termId,
    )).toEqual(['2026-spring', '2026-fall', '2027-spring']);
  });

  it('identifies zero-term discovery explicitly', () => {
    expect(() => assertTermDiscoveryResult({
      discovered: 0,
      terms: [],
    })).toThrow(/returned zero terms/);
  });

  it.each([
    {
      label: 'non-integer count',
      payload: { ...validDiscovery, discovered: 1.5 },
    },
    {
      label: 'count mismatch',
      payload: { ...validDiscovery, discovered: 2 },
    },
    {
      label: 'invalid term ID',
      payload: {
        discovered: 1,
        terms: [{ ...validDiscovery.terms[0], termId: 'wrong' }],
      },
    },
    {
      label: 'invalid year',
      payload: {
        discovered: 1,
        terms: [{ ...validDiscovery.terms[0], year: '2026' }],
      },
    },
    {
      label: 'invalid term',
      payload: {
        discovered: 1,
        terms: [{ ...validDiscovery.terms[0], term: 'autumn' }],
      },
    },
    {
      label: 'invalid status',
      payload: {
        discovered: 1,
        terms: [{ ...validDiscovery.terms[0], status: 'current' }],
      },
    },
    {
      label: 'invalid sample statuses',
      payload: {
        discovered: 1,
        terms: [{ ...validDiscovery.terms[0], sampleStatuses: 'Open' }],
      },
    },
  ])('rejects malformed discovery: $label', ({ payload }) => {
    expect(() => assertTermDiscoveryResult(payload)).toThrow(/malformed/);
  });

  it('rejects duplicate term identities', () => {
    expect(() => assertTermDiscoveryResult({
      discovered: 2,
      terms: [
        validDiscovery.terms[0],
        { ...validDiscovery.terms[0] },
      ],
    })).toThrow(/duplicate term IDs/);
  });

  it('stops before full sync when discovery returns no terms', async () => {
    const request = vi.fn(async (_config: unknown, path: string) => (
      path === '/admin/discover-terms'
        ? { discovered: 0, terms: [] }
        : {}
    ));
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await expect(rebuildRegenerableData(
        stagingReleaseConfig(validEnv),
        request,
      )).rejects.toThrow(/returned zero terms/);
    } finally {
      consoleLog.mockRestore();
    }

    expect(request.mock.calls.map(call => call[1])).toEqual([
      '/health',
      '/admin/discover-terms',
    ]);
  });
});

function termPage(
  term: {
    termId: string;
    year: number;
    term: string;
  },
  subjects: string[],
  pagination: {
    total: number;
    offset: number;
    hasMore: boolean;
  },
) {
  const subjectResults: Array<{
    subject: string;
    success: boolean;
    skipped?: boolean;
    coursesCount: number;
    sectionsCount: number;
    durationMs: number;
  }> = subjects.map(subject => ({
    subject,
    success: true,
    coursesCount: 10,
    sectionsCount: 20,
    durationMs: 1,
  }));
  return {
    termId: term.termId,
    year: term.year,
    term: term.term,
    subjectResults,
    totalCourses: subjectResults.length * 10,
    totalSections: subjectResults.length * 20,
    successfulSubjects: subjectResults.length,
    failedSubjects: 0,
    durationMs: 1,
    rateLimitHits: 0,
    pagination: {
      ...pagination,
      limit: 5,
    },
    forceRunningLocks: true,
    warnings: [],
  };
}
