import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  touchTermStateChecked,
  upsertDiscoveredTermState,
} from '../term-state-repository.js';

describe('term_state database helpers', () => {
  it('touches last_checked without overwriting sync freshness fields', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await touchTermStateChecked(db, '2026-fall', 123);

    const sql = String((prepare.mock.calls as unknown[][])[0]?.[0] ?? '');
    expect(sql).toContain('SET last_checked = ?');
    expect(sql).not.toContain('last_synced');
    expect(bind).toHaveBeenCalledWith(123, '2026-fall');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('updates only discovery-owned fields on conflict', async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await upsertDiscoveredTermState(db, {
      term_id: '2026-fall',
      year: 2026,
      term: 'fall',
      status: 'registrable',
      last_checked: 123,
    });

    const sql = String((prepare.mock.calls as unknown[][])[0]?.[0] ?? '');
    const conflictUpdate = sql.slice(sql.indexOf('ON CONFLICT'));
    expect(conflictUpdate).toContain('status = excluded.status');
    expect(conflictUpdate).toContain('last_checked = excluded.last_checked');
    expect(conflictUpdate).not.toContain('last_synced');
    expect(conflictUpdate).not.toContain('subjects_count');
    expect(conflictUpdate).not.toContain('sync_errors');
  });
});
