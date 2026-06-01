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
  it('passes when restore evidence names the database and backup ref', () => {
    const evidenceFile = makeEvidenceFile([
      '# Restore Evidence',
      'Database: course-search-db-staging',
      'Backup: 20260601T170000Z',
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

  it('rejects evidence that does not name the backup ref', () => {
    const evidenceFile = makeEvidenceFile('Database: course-search-db-staging');

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
    expect(result.stderr).toContain('20260601T170000Z');
  });

  it('rejects destructive-operation preflight without restore verification', () => {
    const evidenceFile = makeEvidenceFile([
      'Database: course-search-db-staging',
      'Backup: 20260601T170000Z',
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
});
