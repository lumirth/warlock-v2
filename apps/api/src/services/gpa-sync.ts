import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import type { SyncState } from '../db/types.js';
import { coordinateEnrichment, enrichCoursesWithGpa } from './enrichment.js';

const DATASET_URL = 'https://cdn.jsdelivr.net/gh/wadefagen/datasets@main/gpa/uiuc-gpa-dataset.csv';
const CACHE_KEY = 'gpa-dataset';
const CHUNK_SIZE = 512 * 1024;
const LEASE_ID = 'gpa-lease';
const LEASE_TTL = 30 * 60;
const GRADE_WEIGHTS = [4, 4, 3.67, 3.33, 3, 2.67, 2.33, 2, 1.67, 1.33, 1, 0.67, 0];
const GRADE_HEADERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
type GpaRow = [string, string, string, string | null, number, number];

export type GpaResetResult = 'skipped_busy' | 'reset_initiated';
export type GpaSyncResult = {
  success: boolean;
  rowsProcessed: number;
  message: string;
  isComplete: boolean;
};

export async function resetGpaSync(db: D1Database, kv: KVNamespace): Promise<GpaResetResult> {
  const owner = await claimLease(db);
  if (!owner) return 'skipped_busy';
  const generation = crypto.randomUUID();
  try {
    await kv.delete(CACHE_KEY);
    await renewLease(db, owner);
    await db.batch([
      db.prepare('DELETE FROM gpa_source_rows'),
      db.prepare(`
        INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, owner_token)
        VALUES ('gpa', NULL, 'pending', 0, 0, ?)
        ON CONFLICT(id) DO UPDATE SET last_sync = NULL, last_status = 'pending',
          items_synced = 0, cursor = 0, owner_token = excluded.owner_token
      `).bind(generation),
    ]);
    return 'reset_initiated';
  } finally {
    await releaseLease(db, owner);
  }
}

export async function resumeGpaSync(db: D1Database, kv: KVNamespace): Promise<GpaSyncResult> {
  const owner = await claimLease(db);
  if (!owner) return result(false, 0, 'GPA import is already running', false);
  try {
    const state = await loadOrCreateImportState(db);
    const stopped = await existingResult(db, state);
    if (stopped) return stopped;
    const generation = requireGeneration(state);
    const published = await publishPendingGpa(db, owner, state, generation);
    if (published) return published;
    const chunk = await loadChunk(kv, state);
    await renewLease(db, owner);
    const { inserted } = await processGpaBatch(db, chunk.lines, chunk.cursor, owner);
    const total = (state?.items_synced ?? 0) + inserted;
    const complete = chunk.end >= chunk.csv.length;
    await checkpoint(db, kv, owner, generation, chunk.end, total, complete);
    if (complete) await publishGpa(db, owner, generation);
    return result(
      true,
      inserted,
      complete ? `Imported ${total} GPA rows` : `Imported ${inserted} GPA rows`,
      complete,
    );
  } finally {
    await releaseLease(db, owner);
  }
}

function requireGeneration(state: SyncState): string {
  if (!state.owner_token) throw new Error('GPA generation is missing; reset required');
  return state.owner_token;
}

async function publishPendingGpa(
  db: D1Database,
  owner: string,
  state: SyncState,
  generation: string,
): Promise<GpaSyncResult | null> {
  if (state.last_status !== 'pending' || (state.cursor ?? 0) <= 0) return null;
  await publishGpa(db, owner, generation);
  return result(true, 0, 'Published imported GPA rows', true);
}

async function existingResult(db: D1Database, state: SyncState | null): Promise<GpaSyncResult | null> {
  if (!state) return null;
  if (state.last_status === 'complete') {
    return result(true, 0, 'GPA import is complete', true);
  }
  if (state.last_status === 'failed') {
    await setImportState(
      db,
      state.owner_token,
      state.cursor ?? 0,
      state.items_synced ?? 0,
      'pending',
    );
  }
  return null;
}

async function loadOrCreateImportState(db: D1Database): Promise<SyncState> {
  const existing = await db.prepare("SELECT * FROM sync_state WHERE id = 'gpa'").first<SyncState>();
  if (existing) return existing;
  const generation = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, owner_token)
    VALUES ('gpa', NULL, 'pending', 0, 0, ?)
  `).bind(generation).run();
  return {
    id: 'gpa',
    last_sync: null,
    last_status: 'pending',
    items_synced: 0,
    cursor: 0,
    owner_token: generation,
  };
}

async function loadChunk(kv: KVNamespace, state: SyncState | null) {
  const loaded = await loadDataset(kv);
  const cursor = state?.cursor ?? 0;
  if (loaded.cacheMiss && cursor > 0) {
    throw new Error('GPA dataset cache expired during import; reset required');
  }
  if (loaded.cacheMiss) await kv.put(CACHE_KEY, loaded.csv, { expirationTtl: 7 * 24 * 60 * 60 });
  const end = chunkEnd(loaded.csv, cursor);
  const lines = loaded.csv.slice(cursor, end).split(/\r?\n/).filter(Boolean);
  if (cursor === 0) assertHeader(lines.shift());
  return { csv: loaded.csv, cursor, end, lines };
}

function assertHeader(line: string | undefined): void {
  const fields = parseCsvLine(line ?? '');
  const grades = fields.slice(7, 20);
  if (fields[0] !== 'Year' || fields[1] !== 'Term'
    || fields[3] !== 'Subject' || fields[4] !== 'Number'
    || fields[5] !== 'Course Title' || fields.at(-1) !== 'Primary Instructor'
    || grades.some((grade, index) => grade !== GRADE_HEADERS[index])) {
    throw new Error('GPA dataset header is invalid');
  }
}

async function checkpoint(
  db: D1Database,
  kv: KVNamespace,
  owner: string,
  generation: string,
  cursor: number,
  total: number,
  complete: boolean,
): Promise<void> {
  if (!complete) return setImportState(db, generation, cursor, total, 'running');
  if (total === 0) throw new Error('refusing empty GPA generation');
  await rebuildAllGpaStats(db, owner, generation);
  await renewLease(db, owner);
  await setImportState(db, generation, cursor, total, 'pending');
  await kv.delete(CACHE_KEY);
}

async function publishGpa(db: D1Database, owner: string, generation: string): Promise<void> {
  await renewLease(db, owner);
  await enrichCoursesWithGpa(db);
  await renewLease(db, owner);
  await coordinateEnrichment(db);
  await renewLease(db, owner);
  await finishGpaEnrichment(db, generation);
}

export async function finishGpaEnrichment(db: D1Database, generation: string): Promise<void> {
  const response = await db.prepare(`
    UPDATE sync_state SET last_sync = unixepoch(), last_status = 'complete'
    WHERE id = 'gpa' AND last_status = 'pending' AND owner_token = ?
  `).bind(generation).run();
  if ((response.meta?.changes ?? 0) !== 1) throw new Error('refusing stale GPA publication');
}

async function processGpaBatch(
  db: D1Database,
  lines: string[],
  rowOffset: number,
  owner: string,
): Promise<{ inserted: number }> {
  const rows: GpaRow[] = lines.flatMap((line, index) => {
    const fields = parseCsvLine(line);
    if (fields.length < 23) return [];
    const counts = GRADE_WEIGHTS.map((_, grade) => Number.parseInt(fields[grade + 7], 10) || 0);
    const students = counts.reduce((sum, count) => sum + count, 0);
    if (!students || !fields[3] || !fields[4]) return [];
    const points = counts.reduce((sum, count, grade) => sum + count * GRADE_WEIGHTS[grade], 0);
    return [[
      `${rowOffset + index}`, fields[3], fields[4], normalizeInstructor(fields.at(-1) ?? ''),
      Math.round(points / students * 100) / 100, students,
    ]];
  });

  await renewLease(db, owner);
  await db.prepare(`
    INSERT INTO gpa_source_rows (
      row_key, subject, number, instructor, avg_gpa, sample_size
    )
    SELECT
      json_extract(value, '$[0]'), json_extract(value, '$[1]'),
      json_extract(value, '$[2]'), json_extract(value, '$[3]'),
      json_extract(value, '$[4]'), json_extract(value, '$[5]')
    FROM json_each(?) WHERE true
    ON CONFLICT(row_key) DO UPDATE SET
      subject = excluded.subject, number = excluded.number, instructor = excluded.instructor,
      avg_gpa = excluded.avg_gpa, sample_size = excluded.sample_size
  `).bind(JSON.stringify(rows)).run();
  return { inserted: rows.length };
}

async function rebuildAllGpaStats(
  db: D1Database,
  owner: string,
  generation: string,
): Promise<void> {
  await renewLease(db, owner);
  await db.batch([
    db.prepare(`
      UPDATE instructor_course_links SET gpa_id = NULL
      WHERE gpa_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM sync_state WHERE id = 'gpa' AND owner_token = ?
      )
    `).bind(generation),
    db.prepare(`
      DELETE FROM gpa_stats WHERE EXISTS (
        SELECT 1 FROM sync_state WHERE id = 'gpa' AND owner_token = ?
      )
    `).bind(generation),
    db.prepare(`
      INSERT INTO gpa_stats (subject, number, instructor, avg_gpa, sample_size)
      SELECT subject, number, instructor,
        CAST(SUM(avg_gpa * sample_size) AS REAL) / SUM(sample_size),
        SUM(sample_size)
      FROM gpa_source_rows
      WHERE EXISTS (
        SELECT 1 FROM sync_state WHERE id = 'gpa' AND owner_token = ?
      )
      GROUP BY subject, number, instructor
    `).bind(generation),
  ]);
}

async function loadDataset(kv: KVNamespace): Promise<{ csv: string; cacheMiss: boolean }> {
  const cached = await kv.get(CACHE_KEY, 'text');
  if (cached) return { csv: cached, cacheMiss: false };
  const response = await fetch(DATASET_URL);
  if (!response.ok) throw new Error(`GPA dataset returned HTTP ${response.status}`);
  const csv = await response.text();
  if (!csv) throw new Error('GPA dataset is empty');
  return { csv, cacheMiss: true };
}

function chunkEnd(csv: string, cursor: number): number {
  if (cursor + CHUNK_SIZE >= csv.length) return csv.length;
  const newline = csv.lastIndexOf('\n', cursor + CHUNK_SIZE);
  if (newline <= cursor) throw new Error('GPA CSV row exceeds the chunk limit');
  return newline + 1;
}

async function setImportState(
  db: D1Database,
  generation: string | null,
  cursor: number,
  items: number,
  status: 'pending' | 'running',
): Promise<void> {
  if (!generation) throw new Error('GPA generation is missing; reset required');
  const response = await db.prepare(`
    UPDATE sync_state SET last_sync = unixepoch(), last_status = ?,
      items_synced = ?, cursor = ?
    WHERE id = 'gpa' AND owner_token = ?
  `).bind(status, items, cursor, generation).run();
  if ((response.meta?.changes ?? 0) !== 1) throw new Error('refusing stale data write');
}

async function claimLease(db: D1Database): Promise<string | null> {
  const owner = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, owner_token)
    VALUES (?, unixepoch(), 'running', 0, 0, ?)
    ON CONFLICT(id) DO UPDATE SET last_sync = unixepoch(), last_status = 'running',
      owner_token = excluded.owner_token
    WHERE sync_state.last_status != 'running' OR sync_state.last_sync <= unixepoch() - ?
  `).bind(LEASE_ID, owner, LEASE_TTL).run();
  return (result.meta?.changes ?? 0) === 1 ? owner : null;
}

async function releaseLease(db: D1Database, owner: string): Promise<void> {
  await db.prepare(`
    UPDATE sync_state SET last_sync = unixepoch(), last_status = 'complete'
    WHERE id = ? AND owner_token = ?
  `).bind(LEASE_ID, owner).run();
}

async function renewLease(db: D1Database, owner: string): Promise<void> {
  const response = await db.prepare(`
    UPDATE sync_state SET last_sync = unixepoch()
    WHERE id = ? AND last_status = 'running' AND owner_token = ?
  `).bind(LEASE_ID, owner).run();
  if ((response.meta?.changes ?? 0) !== 1) throw new Error('refusing stale data write');
}

function result(
  success: boolean,
  rowsProcessed: number,
  message: string,
  isComplete: boolean,
): GpaSyncResult {
  return { success, rowsProcessed, message, isComplete };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let value = '';
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else value += character;
  }
  fields.push(value);
  return fields;
}

function normalizeInstructor(raw: string): string | null {
  const value = raw.replace(/"/g, '').trim().replace(/\s+/g, ' ');
  if (!value) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return value;
  const last = value.slice(0, comma).trim();
  const first = value.slice(comma + 1).trim();
  return first ? `${last}, ${first}` : last || null;
}
