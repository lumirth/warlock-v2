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
        status: 'registrable',
        last_synced: 1780370000,
        subjects_count: 187,
        courses_count: 4400,
        sections_count: 11000,
      },
    ],
    enrichmentCoverage: [
      {
        term_id: '2026-spring',
        status: 'active',
        courses_count: 4494,
        sections_count: 11960,
        courses_with_gpa: 2200,
        courses_with_quality: 3200,
        courses_with_difficulty: 3200,
        enriched_links: 4000,
      },
      {
        term_id: '2026-fall',
        status: 'registrable',
        courses_count: 4400,
        sections_count: 11000,
        courses_with_gpa: 2100,
        courses_with_quality: 3000,
        courses_with_difficulty: 3000,
        enriched_links: 3800,
      },
    ],
    freshness: {
      currentTermId: '2026-spring',
      configuredCurrentTermId: '2026-spring',
      currentTermPresent: true,
      registrableTermIds: ['2026-fall'],
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
        registrableTermIds: [],
        activeTermIds: [],
        upcomingTermIds: [],
        historicalTermCount: 0,
        staleTermIds: ['2026-spring'],
        staleSyncStateIds: ['gpa', 'rmp'],
      },
    }), { minHistoricalTerms: 2 });

    expect(checks.filter(check => !check.ok).map(check => check.name)).toEqual([
      'current term present',
      'registrable term coverage',
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
      retention_source: null,
      checks: auditFreshnessStatus(status(), { minHistoricalTerms: 10 }),
    };

    expect(formatFreshnessAuditReport(report)).toContain('PASS current term present');
  });

  it('fails when active or registrable enrichment coverage is missing or zero', () => {
    const zeroChecks = auditFreshnessStatus(status({
      enrichmentCoverage: [
        {
          term_id: '2026-spring',
          status: 'active',
          courses_count: 4494,
          sections_count: 11960,
          courses_with_gpa: 0,
          courses_with_quality: 0,
          courses_with_difficulty: 0,
          enriched_links: 0,
        },
        {
          term_id: '2026-fall',
          status: 'registrable',
          courses_count: 4400,
          sections_count: 11000,
          courses_with_gpa: 2100,
          courses_with_quality: 3000,
          courses_with_difficulty: 3000,
          enriched_links: 3800,
        },
      ],
    }), { minHistoricalTerms: 10 });

    expect(zeroChecks.find(check => check.name === 'active/registrable enrichment coverage')).toEqual({
      name: 'active/registrable enrichment coverage',
      ok: false,
      detail: 'zero GPA/score/link coverage for 2026-spring',
    });

    const missingChecks = auditFreshnessStatus(status({
      enrichmentCoverage: [
        {
          term_id: '2026-spring',
          status: 'active',
          courses_count: 4494,
          sections_count: 11960,
          courses_with_gpa: 2200,
          courses_with_quality: 3200,
          courses_with_difficulty: 3200,
          enriched_links: 4000,
        },
      ],
    }), { minHistoricalTerms: 10 });

    expect(missingChecks.find(check => check.name === 'active/registrable enrichment coverage')).toEqual({
      name: 'active/registrable enrichment coverage',
      ok: false,
      detail: 'missing coverage for 2026-fall',
    });
  });

  it('checks retained full-detail coverage and dropped term absence from a retention plan', () => {
    const checks = auditFreshnessStatus(status({
      termStates: [
        {
          term_id: '2026-spring',
          year: 2026,
          term: 'spring',
          status: 'active',
          courses_count: 4494,
          sections_count: 11960,
        },
        {
          term_id: '2026-fall',
          year: 2026,
          term: 'fall',
          status: 'registrable',
          courses_count: 4400,
          sections_count: 11000,
        },
        {
          term_id: '2004-spring',
          year: 2004,
          term: 'spring',
          status: 'historical',
          courses_count: 10,
          sections_count: 20,
        },
      ],
    }), {
      retentionPlan: {
        retainedTermIds: ['2026-spring', '2026-fall', '2025-fall'],
        droppedTermIds: ['2004-spring'],
      },
    });

    expect(checks.filter(check => !check.ok).map(check => check.name)).toEqual([
      'retained corpus term coverage',
      'retained corpus full-detail counts',
      'dropped term absence',
    ]);
  });

  it('writes JSON and markdown reports from the CLI', () => {
    const inputFile = makeTempFile('sync-status.json', JSON.stringify(status()));
    const retentionFile = makeTempFile('retention.json', JSON.stringify({
      retained_term_ids: ['2026-spring', '2026-fall'],
      dropped_term_ids: ['2004-spring'],
    }));
    const outputFile = join(tempRoot!, 'audit.json');

    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      'scripts/data-freshness-audit.ts',
      '--input',
      inputFile,
      '--output',
      outputFile,
      '--min-historical-terms',
      '10',
      '--retention-input',
      retentionFile,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(outputFile, 'utf8')) as FreshnessAuditReport;
    expect(report.retention_source).toBe(retentionFile);
    expect(report.checks.every(check => check.ok)).toBe(true);
    expect(readFileSync(outputFile.replace(/\.json$/i, '.md'), 'utf8')).toContain('Data Freshness Audit');
  });

  it('keeps JSON and markdown distinct for extensionless output paths', () => {
    const inputFile = makeTempFile('sync-status.json', JSON.stringify(status()));
    const outputFile = join(tempRoot!, 'audit');

    const result = spawnSync(process.execPath, [
      '--import',
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
    expect(JSON.parse(readFileSync(outputFile, 'utf8'))).toEqual(expect.objectContaining({
      source: inputFile,
    }));
    expect(readFileSync(`${outputFile}.md`, 'utf8')).toContain('Data Freshness Audit');
  });
});
