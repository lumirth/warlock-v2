import type { D1Database } from '@cloudflare/workers-types';
import type { SyncState } from './types.js';

export async function getSyncState(db: D1Database, id: string): Promise<SyncState | null> {
  return db.prepare('SELECT * FROM sync_state WHERE id = ?').bind(id).first<SyncState>();
}

export async function upsertSyncState(db: D1Database, state: SyncState): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(state.id, state.last_sync, state.last_status, state.items_synced, state.cursor, state.etag).run();
}
