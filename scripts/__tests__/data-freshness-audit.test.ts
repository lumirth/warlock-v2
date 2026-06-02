import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditFreshnessStatus,
  formatFreshnessAuditReport,
  type FreshnessAuditReport,
} from '../data-freshness-audit.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

let tempRoot: string | undefined;

function makeTempFile(name: string, contents: string): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'freshness-audit-test-'));
  const file = join(tempRoot, name);
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function status(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: '2026-06-02T12:00:00.000Z',
    syncStates: [
      { id: 'gpa', last_sync: 1780370000, last_status: 'complete', items_synced: 100, cursor: 0, etag: null },
      { id: 'rmp', last_sync: 1780370000, last_status: 'complete', items_synced: 100, cursor: 0, etag: null },
    ],
    termStates: [
      {
        term_id: '2026-spring',
        year: 2026,
        term: 'spring',
        status: 'active',
        last_synced: 1780370000,
        subjects_count: 187,
        courses_count: 4494,
        sections_count: 11960,
      },
      {
        term_id: '2026-fall',
        year: 2026,
        term: 'fall',
        status: 'active',
        last_synced: 1780370000,
        subjects_count: 187,
        courses_count: 4400,
        sections_count: 11000,
      },
    ],
    freshness: {
      currentTermId: '2026-spring',
      currentTermPresent: true,
      activeTermIds: ['2026-spring', '2026-fall'],
      upcomingTermIds: ['2026-fall'],
      historicalTermCount: 12,
      staleTermIds: [],
      staleSyncStateIds: [],
    },
    ...overrides,
  };
}

describe('data freshness audit', () => {
  it('passes when current, upcoming, historical, GPA, and RMP evidence is healthy', () => {
    const checks = auditFreshnessStatus(status(), { minHistoricalTerms: 10 });

    expect(checks.every(check => check.ok)).toBe(true);
    expect(checks.map(check => check.name)).toContain('current term has course and section counts');
  });

  it('fails when key freshness evidence is stale or absent', () => {
    const checks = auditFreshnessStatus(status({
      syncStates: [{ id: 'gpa', last_sync: null, last_status: 'failed' }],
      freshness: {
        currentTermId: '2026-spring',
        currentTermPresent: false,
        activeTermIds: [],
        upcomingTermIds: [],
        historicalTermCount: 0,
        staleTermIds: ['2026-spring'],
        staleSyncStateIds: ['gpa', 'rmp'],
      },
    }), { minHistoricalTerms: 2 });

    expect(checks.filter(check => !check.ok).map(check => check.name)).toEqual([
      'current term present',
      'active term coverage',
      'historical term coverage',
      'no stale terms',
      'no stale sync states',
      'gpa sync state fresh',
      'rmp sync state fresh',
    ]);
  });

  it('formats a readable markdown report', () => {
    const report: FreshnessAuditReport = {
      generated_at: '2026-06-02T12:00:00.000Z',
      source: 'fixture',
      checks: auditFreshnessStatus(status(), { minHistoricalTerms: 10 }),
    };

    expect(formatFreshnessAuditReport(report)).toContain('PASS current term present');
  });

  it('writes JSON and markdown reports from the CLI', () => {
    const inputFile = makeTempFile('sync-status.json', JSON.stringify(status()));
    const outputFile = join(tempRoot!, 'audit.json');

    const result = spawnSync('npx', [
      'tsx',
      'scripts/data-freshness-audit.ts',
      '--input',
      inputFile,
      '--output',
      outputFile,
      '--min-historical-terms',
      '10',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(outputFile, 'utf8')) as FreshnessAuditReport;
    expect(report.checks.every(check => check.ok)).toBe(true);
    expect(readFileSync(outputFile.replace(/\.json$/i, '.md'), 'utf8')).toContain('Data Freshness Audit');
  });
});
