import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFeedbackCandidateReport,
  parseFeedbackExport,
  type FeedbackCandidateReport,
} from '../feedback-corpus-candidates.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

let tempRoot: string | undefined;

function makeTempFile(name: string, contents: string): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'feedback-triage-test-'));
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

describe('feedback corpus candidates', () => {
  it('parses Wrangler D1 JSON exports and creates instructor eval candidates', () => {
    const rows = parseFeedbackExport(JSON.stringify([
      {
        results: [{
          id: 'feedback-1',
          kind: 'search_results',
          issue: 'expected_different_results',
          page: 'search',
          query: 'professor fagen algorithms',
          expected: 'CS courses taught by Wade Fagen-Ulmschneider',
          instructor_name: 'Fagen-Ulmschneider, W',
          metadata: '{"resultCount":3}',
          created_at: '1780370000',
        }],
      },
    ]));

    const report = buildFeedbackCandidateReport(rows, 'wrangler.json', new Date('2026-06-02T06:00:00Z'));

    expect(report).toMatchObject({
      generated_at: '2026-06-02T06:00:00.000Z',
      row_count: 1,
      candidate_count: 1,
    });
    expect(report.candidates[0]).toMatchObject({
      id: 'feedback-1',
      target: 'search_eval',
      priority: 'high',
      query: 'professor fagen algorithms',
      instructorName: 'Fagen-Ulmschneider, W',
      metadata: { resultCount: 3 },
      suggestedGoldQuery: {
        query: 'professor fagen algorithms',
        expected_filter_keys: ['instructor_ids'],
        category: 'instructor',
      },
    });
  });

  it('routes score reports to score audits instead of generating premature search evals', () => {
    const report = buildFeedbackCandidateReport([
      {
        id: 'score-1',
        kind: 'score',
        issue: 'wrong_score',
        page: 'course',
        subject: 'CS',
        number: '225',
        score_field: 'difficulty',
        message: 'This workload score looks far too easy.',
      },
    ], 'inline', new Date('2026-06-02T06:00:00Z'));

    expect(report.candidates[0]).toMatchObject({
      target: 'score_audit',
      priority: 'high',
      query: 'CS 225',
      scoreField: 'difficulty',
    });
    expect(report.candidates[0].suggestedGoldQuery).toBeUndefined();
    expect(report.candidates[0].reviewChecklist.join(' ')).toContain('score inputs');
  });

  it('supports newline-delimited JSON and skips unknown feedback shapes', () => {
    const rows = parseFeedbackExport([
      '{"id":"link-1","kind":"external_link","issue":"broken_link","page":"course","subject":"MATH","number":"241"}',
      '{"id":"bad-1","kind":"unsupported","issue":"other","page":"search"}',
    ].join('\n'));

    const report = buildFeedbackCandidateReport(rows, 'feedback.ndjson', new Date('2026-06-02T06:00:00Z'));

    expect(report.row_count).toBe(2);
    expect(report.candidate_count).toBe(1);
    expect(report.candidates[0]).toMatchObject({
      id: 'link-1',
      target: 'link_audit',
      query: 'MATH 241',
    });
  });

  it('writes a stable JSON report from the CLI', async () => {
    const inputFile = makeTempFile('feedback.json', JSON.stringify([{
      id: 'missing-1',
      kind: 'course_result',
      issue: 'missing_course',
      page: 'search',
      query: 'CS 225',
      subject: 'CS',
      number: '225',
    }]));
    const outputFile = join(tempRoot!, 'candidates.json');

    const result = spawnSync('npx', [
      'tsx',
      'scripts/feedback-corpus-candidates.ts',
      '--input',
      inputFile,
      '--output',
      outputFile,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(await readFile(outputFile, 'utf8')) as FeedbackCandidateReport;
    expect(report.candidates[0].suggestedGoldQuery).toMatchObject({
      query: 'CS 225',
      expected_filters: { subject: 'CS', number: '225' },
      expected_residual: '',
      category: 'navigational',
    });
  });
});
