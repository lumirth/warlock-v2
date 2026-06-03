import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFeedbackExportCommand,
  buildFeedbackExportSql,
  parseArgs,
  resolveFeedbackExportPaths,
  writeFeedbackArtifacts,
  type FeedbackExportPaths,
} from '../export-feedback.ts';

let tempRoot: string | undefined;

function tempPath(name: string): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'feedback-export-test-'));
  return join(tempRoot, name);
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe('feedback export', () => {
  it('builds a remote Wrangler D1 export command by default', () => {
    const args = parseArgs([]);
    const command = buildFeedbackExportCommand(args);

    expect(command.command).toBe('npx');
    expect(command.args.slice(0, 5)).toEqual([
      'wrangler',
      'd1',
      'execute',
      'course-search-db-staging',
      '--remote',
    ]);
    expect(command.args).toContain('--json');
    expect(command.args.at(-1)).toContain('FROM feedback_events');
    expect(command.args.at(-1)).toContain('LIMIT 200');
  });

  it('supports local exports and bounded limits', () => {
    const args = parseArgs([
      '--database',
      'course-search-db-preview',
      '--limit',
      '17',
      '--local',
    ]);
    const command = buildFeedbackExportCommand(args);

    expect(command.args).not.toContain('--remote');
    expect(command.args).toContain('course-search-db-preview');
    expect(command.args.at(-1)).toContain('LIMIT 17');
  });

  it('rejects unsafe export limits before building SQL', () => {
    expect(() => parseArgs(['--limit', '0'])).toThrow(/between 1 and 1000/);
    expect(() => buildFeedbackExportSql(1001)).toThrow(/between 1 and 1000/);
  });

  it('resolves timestamped export and candidate paths', () => {
    const paths = resolveFeedbackExportPaths(
      parseArgs(['--output-dir', 'artifacts/feedback']),
      new Date('2026-06-03T03:00:00.000Z')
    );

    expect(paths).toEqual({
      exportPath: 'artifacts/feedback/feedback-events-20260603T030000Z.json',
      candidatesPath: 'artifacts/feedback/feedback-events-20260603T030000Z-candidates.json',
    });
  });

  it('writes raw feedback export and generated corpus candidates', async () => {
    const paths: FeedbackExportPaths = {
      exportPath: tempPath('feedback.json'),
      candidatesPath: tempPath('feedback-candidates.json'),
    };
    const rawExport = JSON.stringify([{
      results: [{
        id: 'feedback-1',
        kind: 'search_results',
        issue: 'expected_different_results',
        page: 'search',
        query: 'intro to philosophy',
        subject: 'PHIL',
        expected: 'Introductory philosophy courses',
      }],
    }]);

    const summary = await writeFeedbackArtifacts(rawExport, 'test-export', paths, new Date('2026-06-03T03:00:00.000Z'));
    const candidates = JSON.parse(await readFile(paths.candidatesPath!, 'utf8'));

    expect(summary).toEqual({ rowCount: 1, candidateCount: 1 });
    expect(await readFile(paths.exportPath, 'utf8')).toContain('feedback-1');
    expect(candidates).toMatchObject({
      source: 'test-export',
      row_count: 1,
      candidate_count: 1,
      candidates: [{
        id: 'feedback-1',
        target: 'search_eval',
        priority: 'high',
        suggestedFailureClasses: ['introductory_gateway', 'subject_alias'],
        suggestedGoldQuery: {
          query: 'intro to philosophy',
          expected_filters: { subject: 'PHIL' },
          category: 'structured',
        },
      }],
    });
  });
});
