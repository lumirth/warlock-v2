import type { D1Database } from '@cloudflare/workers-types';
import type { TermState, TermStateStatus } from './types.js';

export async function upsertTermState(
  db: D1Database,
  termState: Omit<TermState, 'created_at' | 'updated_at'>
): Promise<void> {
  await db.prepare(`
    INSERT INTO term_state (term_id, year, term, status, last_checked, last_synced,
                            subjects_count, courses_count, sections_count, sync_errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(term_id) DO UPDATE SET
      status = excluded.status,
      last_checked = excluded.last_checked,
      last_synced = excluded.last_synced,
      subjects_count = excluded.subjects_count,
      courses_count = excluded.courses_count,
      sections_count = excluded.sections_count,
      sync_errors = excluded.sync_errors,
      updated_at = unixepoch()
  `).bind(
    termState.term_id, termState.year, termState.term, termState.status,
    termState.last_checked, termState.last_synced, termState.subjects_count,
    termState.courses_count, termState.sections_count, termState.sync_errors
  ).run();
}

export async function touchTermStateChecked(
  db: D1Database,
  termId: string,
  lastChecked: number
): Promise<void> {
  await db.prepare(`
    UPDATE term_state
    SET last_checked = ?, updated_at = unixepoch()
    WHERE term_id = ?
  `).bind(lastChecked, termId).run();
}

export async function getTermsByStatus(
  db: D1Database,
  status: TermStateStatus
): Promise<TermState[]> {
  const result = await db.prepare(
    `SELECT * FROM term_state
     WHERE status = ?
     ORDER BY year DESC,
       CASE term
         WHEN 'fall' THEN 0
         WHEN 'spring' THEN 0
         WHEN 'summer' THEN 1
         WHEN 'winter' THEN 1
         ELSE 2
       END,
       CASE term
         WHEN 'fall' THEN 4
         WHEN 'summer' THEN 3
         WHEN 'spring' THEN 2
         WHEN 'winter' THEN 1
         ELSE 0
       END DESC`
  ).bind(status).all<TermState>();
  return result.results;
}

export async function getTermState(
  db: D1Database,
  termId: string
): Promise<TermState | null> {
  return db.prepare(
    'SELECT * FROM term_state WHERE term_id = ?'
  ).bind(termId).first<TermState>();
}
