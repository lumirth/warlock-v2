import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { convertSqlToCsv } from '../sql-to-csv.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

let tempRoot: string | undefined;

function tempPath(name: string): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'sql-to-csv-test-'));
  return join(tempRoot, name);
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe('sql to csv', () => {
  it('preserves meeting_instructors SELECT inserts in a post-import SQL artifact', async () => {
    const input = tempPath('input.sql');
    const outputDir = tempPath('csv');
    const joinSql = "INSERT OR IGNORE INTO meeting_instructors (meeting_id, instructor_id) SELECT m.id, i.id FROM meetings m, instructors i WHERE m.section_id = '2026-spring-CS-225-12345' AND m.meeting_index = 0 AND i.last_name = 'Smith' AND i.first_name = 'Jane';";
    writeFileSync(input, [
      "INSERT OR REPLACE INTO courses (id, subject, number) VALUES ('CS-225', 'CS', '225');",
      joinSql,
    ].join('\n'));

    const summary = await convertSqlToCsv(input, outputDir);

    expect(summary.counts.get('courses')).toBe(1);
    expect(summary.postImportStatements).toBe(1);
    expect(readFileSync(join(outputDir, 'courses.csv'), 'utf8')).toContain('"CS-225","CS","225"');
    expect(readFileSync(join(outputDir, 'post-import.sql'), 'utf8')).toContain(joinSql);
  });

  it('exits nonzero when the input SQL file cannot be read', () => {
    const outputDir = tempPath('csv');
    const result = spawnSync('npx', [
      'tsx',
      'scripts/sql-to-csv.ts',
      tempPath('missing.sql'),
      outputDir,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('ENOENT');
    expect(existsSync(join(outputDir, 'courses.csv'))).toBe(false);
  });
});
