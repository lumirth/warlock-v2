import { describe, expect, it } from 'vitest';
import {
  assertCourseSyncStatus,
  assertFullCourseSyncResult,
  latestMigrationName,
  latestMigrationSha256,
  releaseCommands,
  stagingReleaseConfig,
} from '../staging-api-release.js';

const validEnv = {
  STAGING_API_BASE_URL: 'https://uiuc-course-search-staging.lumirth.workers.dev',
  STAGING_ADMIN_TOKEN: 'secret-admin-token',
  STAGING_MIGRATION_APPROVED: latestMigrationName(),
  STAGING_MIGRATION_SHA256_APPROVED: latestMigrationSha256(),
  D1_BACKUP_REF: '20260728T010203Z',
  D1_BACKUP_EVIDENCE_FILE: 'artifacts/d1-backup-evidence.md',
};

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
