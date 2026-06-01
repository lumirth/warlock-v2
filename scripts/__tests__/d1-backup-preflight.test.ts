import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

let tempRoot: string | undefined;

function makeEvidenceFile(contents: string): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'd1-preflight-test-'));
  const evidenceFile = join(tempRoot, 'evidence.md');
  writeFileSync(evidenceFile, contents);
  return evidenceFile;
}

function runPreflight(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('npx', ['tsx', 'scripts/d1-backup-preflight.ts', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe('D1 backup preflight', () => {
  it('passes when restore evidence includes concrete backup and restore markers', () => {
    const evidenceFile = makeEvidenceFile([
      '# Restore Evidence',
      'Database: course-search-db-staging',
      'D1 Backup Ref: 20260601T170000Z',
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-20260601T170000Z.sql',
      'D1 Restore Database: course-search-db-staging-restore-20260601T170000Z',
      'D1 Restore Verified: yes',
    ].join('\n'));

    const result = runPreflight([
      '--database',
      'course-search-db-staging',
      '--backup-ref',
      '20260601T170000Z',
      '--evidence-file',
      evidenceFile,
      '--restore-verified',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'D1 backup preflight passed for course-search-db-staging using backup 20260601T170000Z.'
    );
  });

  it('passes with Cloudflare D1 Time Travel restore evidence', () => {
    const evidenceFile = makeEvidenceFile([
      '# Restore Evidence',
      'Database: course-search-db-staging',
      'D1 Backup Ref: 20260601T193901Z',
      'D1 Backup Mechanism: Cloudflare D1 Time Travel',
      'D1 Backup Location: Cloudflare D1 Time Travel bookmark 00000007-00000000-0000507d-803e9baeab336cc69be070cd8a1df251 for ref 20260601T193901Z',
      'D1 Restore Database: course-search-db-staging',
      'D1 Restore Verified: yes',
    ].join('\n'));

    const result = runPreflight([
      '--database',
      'course-search-db-staging',
      '--backup-ref',
      '20260601T193901Z',
      '--evidence-file',
      evidenceFile,
      '--restore-verified',
    ]);

    expect(result.status).toBe(0);
  });

  it('rejects evidence that does not name the backup ref', () => {
    const evidenceFile = makeEvidenceFile([
      'Database: course-search-db-staging',
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-20260601T170000Z.sql',
      'D1 Restore Database: course-search-db-staging-restore-20260601T170000Z',
      'D1 Restore Verified: yes',
    ].join('\n'));

    const result = runPreflight([
      '--database',
      'course-search-db-staging',
      '--backup-ref',
      '20260601T170000Z',
      '--evidence-file',
      evidenceFile,
      '--restore-verified',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Evidence file does not mention required backup markers');
    expect(result.stderr).toContain('D1 Backup Ref: 20260601T170000Z');
  });

  it('rejects destructive-operation preflight without restore verification', () => {
    const evidenceFile = makeEvidenceFile([
      'Database: course-search-db-staging',
      'D1 Backup Ref: 20260601T170000Z',
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-20260601T170000Z.sql',
      'D1 Restore Database: course-search-db-staging-restore-20260601T170000Z',
      'D1 Restore Verified: yes',
    ].join('\n'));

    const result = runPreflight([
      '--database',
      'course-search-db-staging',
      '--backup-ref',
      '20260601T170000Z',
      '--evidence-file',
      evidenceFile,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing D1 backup preflight requirements: --restore-verified');
  });

  it('rejects non-timestamp backup refs', () => {
    const evidenceFile = makeEvidenceFile([
      'Database: course-search-db-staging',
      'D1 Backup Ref: latest',
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-latest.sql',
      'D1 Restore Database: course-search-db-staging-restore-latest',
      'D1 Restore Verified: yes',
    ].join('\n'));

    const result = runPreflight([
      '--database',
      'course-search-db-staging',
      '--backup-ref',
      'latest',
      '--evidence-file',
      evidenceFile,
      '--restore-verified',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Backup ref must use YYYYMMDDTHHMMSSZ format');
  });

  it('rejects evidence without restore database and restore verified markers', () => {
    const evidenceFile = makeEvidenceFile([
      'Database: course-search-db-staging',
      'D1 Backup Ref: 20260601T170000Z',
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-20260601T170000Z.sql',
    ].join('\n'));

    const result = runPreflight([
      '--database',
      'course-search-db-staging',
      '--backup-ref',
      '20260601T170000Z',
      '--evidence-file',
      evidenceFile,
      '--restore-verified',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('D1 Restore Database: course-search-db-staging-restore-20260601T170000Z');
    expect(result.stderr).toContain('D1 Restore Verified: yes');
  });
});
