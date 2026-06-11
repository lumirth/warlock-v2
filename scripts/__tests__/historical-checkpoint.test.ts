import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoricalSyncCheckpointStore } from '../lib/historical-checkpoint.ts';
import { reconcileSqlOutputWithCheckpoint } from '../lib/historical-sync-sql-output.ts';

let tempRoot: string | undefined;
const SCOPE = { startYear: 2026, endYear: 2026, termFilter: 'fall' };

function makeTempRoot(): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'historical-checkpoint-test-'));
  return tempRoot;
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe('historical sync checkpoint durability', () => {
  it('atomically persists resumable progress and its exact SQL artifact position', () => {
    const root = makeTempRoot();
    const checkpointPath = join(root, 'state', 'checkpoint.json');
    const sqlPath = join(root, 'historical.sql');
    writeFileSync(sqlPath, 'BEGIN TRANSACTION;\n');

    const item = { year: 2026, term: 'fall', subject: 'CS' };
    const store = new HistoricalSyncCheckpointStore(checkpointPath, () => {});
    store.markCompleted(item, { termId: '2026-fall', courses: 4, sections: 12 });
    store.save(SCOPE, { path: resolve(sqlPath), committedBytes: statSync(sqlPath).size });

    const loaded = new HistoricalSyncCheckpointStore(checkpointPath, () => {});
    loaded.load();

    expect(loaded.isCompleted(item)).toBe(true);
    expect(loaded.getSqlOutput()).toEqual({
      path: resolve(sqlPath),
      committedBytes: statSync(sqlPath).size,
    });
    expect(loaded.termResultsFromCheckpoint([item]).get('2026-fall')).toEqual({
      courses: 4,
      sections: 12,
      subjects: 1,
    });
    expect(readdirSync(join(root, 'state'))).toEqual(['checkpoint.json']);
  });

  it('fails closed instead of silently restarting from a corrupt checkpoint', () => {
    const checkpointPath = join(makeTempRoot(), 'checkpoint.json');
    writeFileSync(checkpointPath, '{"completedItems":"not-an-array"}');

    const store = new HistoricalSyncCheckpointStore(checkpointPath, () => {});

    expect(() => store.load()).toThrow('Refusing to continue with unreadable checkpoint');
  });

  it('propagates checkpoint write failures instead of claiming progress was saved', () => {
    const root = makeTempRoot();
    const parentFile = join(root, 'not-a-directory');
    writeFileSync(parentFile, 'occupied');
    const store = new HistoricalSyncCheckpointStore(join(parentFile, 'checkpoint.json'), () => {});

    expect(() => store.save(SCOPE, { path: join(root, 'historical.sql'), committedBytes: 0 })).toThrow();
  });

  it('truncates uncheckpointed SQL and rejects mismatched or shortened artifacts', () => {
    const root = makeTempRoot();
    const sqlPath = join(root, 'historical.sql');
    const committedSql = 'BEGIN TRANSACTION;\nINSERT INTO courses VALUES (1);\n';
    writeFileSync(sqlPath, `${committedSql}PARTIAL CRASHED WRITE`);

    reconcileSqlOutputWithCheckpoint(sqlPath, {
      path: resolve(sqlPath),
      committedBytes: Buffer.byteLength(committedSql),
    });

    expect(readFileSync(sqlPath, 'utf-8')).toBe(committedSql);
    expect(() => reconcileSqlOutputWithCheckpoint(sqlPath, {
      path: join(root, 'different.sql'),
      committedBytes: Buffer.byteLength(committedSql),
    })).toThrow('Checkpoint belongs to');
    expect(() => reconcileSqlOutputWithCheckpoint(sqlPath, {
      path: resolve(sqlPath),
      committedBytes: Buffer.byteLength(committedSql) + 1,
    })).toThrow('shorter than the checkpointed');
  });

  it('clears persisted and in-memory progress together', () => {
    const root = makeTempRoot();
    const checkpointPath = join(root, 'checkpoint.json');
    const item = { year: 2026, term: 'fall', subject: 'CS' };
    const store = new HistoricalSyncCheckpointStore(checkpointPath, () => {});
    store.markCompleted(item, { termId: '2026-fall', courses: 1, sections: 2 });
    store.save(SCOPE, { path: join(root, 'historical.sql'), committedBytes: 0 });

    store.clear();

    expect(existsSync(checkpointPath)).toBe(false);
    expect(store.isCompleted(item)).toBe(false);
    expect(store.getSqlOutput()).toBeUndefined();
  });

  it('refuses to merge progress into a different run scope or SQL artifact', () => {
    const root = makeTempRoot();
    const sqlPath = resolve(root, 'historical.sql');
    const checkpointPath = join(root, 'checkpoint.json');
    const item = { year: 2026, term: 'fall', subject: 'CS' };
    const store = new HistoricalSyncCheckpointStore(checkpointPath, () => {});
    store.markCompleted(item, { termId: '2026-fall', courses: 1, sections: 2 });
    store.save(SCOPE, { path: sqlPath, committedBytes: 0 });

    const loaded = new HistoricalSyncCheckpointStore(checkpointPath, () => {});
    loaded.load();

    expect(() => loaded.assertCompatible(
      { startYear: 2025, endYear: 2026, termFilter: 'fall' },
      sqlPath,
    )).toThrow('different year/term selection');
    expect(() => loaded.assertCompatible(SCOPE, resolve(root, 'other.sql')))
      .toThrow('Existing progress belongs to');
  });
});
