import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getSyncState } from '../db/sync-state-repository.js';
import type { SyncState } from '../db/types.js';
import { errorFields, logger } from '../observability/logger.js';

const GPA_DATASET_URL = 'https://cdn.jsdelivr.net/gh/wadefagen/datasets@main/gpa/uiuc-gpa-dataset.csv';
// 50K chars is safe for 10ms CPU limit (approx 500 lines)
const CHUNK_SIZE_CHARS = 50 * 1024;
const D1_BATCH_SIZE = 15;
const KV_KEY = 'gpa_full_dataset';
const GPA_DATASET_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const GPA_MUTATION_LEASE_ID = 'gpa-mutation-lease';
const GPA_MUTATION_LEASE_TTL_SECONDS = 30 * 60;
const GPA_ENRICHMENT_STATE_ID = 'gpa-completion-enrichment';
const GPA_ENRICHMENT_CLAIM_TTL_SECONDS = 30 * 60;

// GPA Weights
const WEIGHTS: Record<string, number> = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.67,
  'B+': 3.33, 'B': 3.0, 'B-': 2.67,
  'C+': 2.33, 'C': 2.0, 'C-': 1.67,
  'D+': 1.33, 'D': 1.0, 'D-': 0.67,
  'F': 0.0
};

interface GpaRecord {
  rowKey: string;
  sourceYear: number;
  sourceTerm: string;
  subject: string;
  number: string;
  instructor: string | null;
  avgGpa: number;
  sampleSize: number;
}

export interface GpaSyncResult {
  success: boolean;
  rowsProcessed: number;
  message: string;
  isComplete: boolean;
  completionKey: string | null;
}

export type GpaResetResult =
  | 'skipped_no_changes'
  | 'skipped_busy'
  | 'reset_initiated';

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function hashCsvLine(line: string): Promise<string> {
  return sha256Text(line);
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function completionKey(etag: string | null | undefined, cursor: number): string {
  return `${etag ?? 'unversioned'}:${cursor}`;
}

/**
 * Resumes GPA sync using KV-cached dataset to allow reliable slicing.
 * Bypasses external HTTP Range/Compression issues.
 */
export async function resumeGpaSync(db: D1Database, kv: KVNamespace): Promise<GpaSyncResult> {
  const leaseOwner = await claimGpaMutationLease(db, 'resume');
  if (!leaseOwner) {
    return {
      success: false,
      rowsProcessed: 0,
      message: 'GPA sync mutation lease is busy',
      isComplete: false,
      completionKey: null,
    };
  }

  try {
    return await resumeGpaSyncUnderLease(db, kv, leaseOwner);
  } finally {
    await releaseGpaMutationLease(db, leaseOwner);
  }
}

async function resumeGpaSyncUnderLease(
  db: D1Database,
  kv: KVNamespace,
  leaseOwner: string
): Promise<GpaSyncResult> {
  // 1. Get current cursor
  const state = await getSyncState(db, 'gpa');
  const cursor = state?.cursor || 0;

  logger.info('gpa.resume.start', { cursor });

  // A completed generation is a cheap no-op. Its durable completion key lets a
  // failed enrichment be retried without downloading or reprocessing the CSV.
  if (state?.last_status === 'complete') {
    return {
      success: true,
      rowsProcessed: 0,
      message: 'Sync already complete',
      isComplete: true,
      completionKey: completionKey(state.etag, cursor),
    };
  }

  // 2. Get Data (Cache-First)
  let fullText = await kv.get(KV_KEY, 'text');
  let fetchedEtag: string | null = null;

  if (!fullText) {
    logger.info('gpa.resume.cacheMiss');
    const response = await fetch(GPA_DATASET_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch GPA dataset: ${response.status} ${response.statusText}`);
    }

    fullText = await response.text();
    fetchedEtag = response.headers.get('etag');
    if (!fullText) {
      throw new Error('Fetched empty dataset');
    }

    const fetchedIdentity = fetchedEtag ?? `sha256:${await sha256Text(fullText)}`;
    if (cursor > 0 && state?.etag && state.etag !== fetchedIdentity) {
      throw new Error(
        'GPA dataset changed while a generation was in progress; reset is required before resuming'
      );
    }

    // The import advances one chunk per five-minute cron. Keep one immutable
    // generation cached long enough for a large dataset to finish, rather than
    // silently refetching and splicing a newer body at the old byte cursor.
    await kv.put(KV_KEY, fullText, {
      expirationTtl: GPA_DATASET_CACHE_TTL_SECONDS,
    });
    logger.info('gpa.resume.cachedDataset', { characters: fullText.length });
  }
  const generationEtag = fetchedEtag
    ?? state?.etag
    ?? `sha256:${await sha256Text(fullText)}`;

  // 3. Check for completion
  if (cursor >= fullText.length) {
    logger.info('gpa.resume.complete', { cursor });
    await rebuildAllGpaStats(db, leaseOwner);

    await writeGpaCheckpoint(db, state, {
      id: 'gpa',
      last_sync: currentUnixSeconds(),
      last_status: 'complete',
      items_synced: (state?.items_synced || 0),
      cursor: cursor, // Keep cursor at end
      etag: generationEtag,
    });
    await kv.delete(KV_KEY);

    return {
      success: true,
      rowsProcessed: 0,
      message: 'Sync Complete (EOF)',
      isComplete: true,
      completionKey: completionKey(generationEtag, cursor),
    };
  }

  // 4. Slice Chunk
  // Determine chunk boundaries, respecting newlines
  const endEstimate = Math.min(cursor + CHUNK_SIZE_CHARS, fullText.length);
  let nextCursor = endEstimate;

  if (endEstimate < fullText.length) {
    // Look backwards for the last newline to ensure we don't cut a line in half
    const lastNewline = fullText.lastIndexOf('\n', endEstimate);
    if (lastNewline > cursor) {
      nextCursor = lastNewline + 1; // Start next chunk AFTER the newline
    } else {
      // No newline found in this chunk? Line is huge.
      // Force break or extend (extending is dangerous for CPU).
      // Let's force break and hope parser handles it or extend slightly.
      // Actually, if a line is > 50KB, we have other problems.
      logger.warn('gpa.resume.noNewlineInChunk', { cursor, endEstimate });
      const nextNewline = fullText.indexOf('\n', endEstimate);
      if (nextNewline !== -1) {
        nextCursor = nextNewline + 1;
      }
    }
  }

  const chunk = fullText.substring(cursor, nextCursor);

  // 5. Parse & Insert
  const lines = chunk.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);

  // Skip header if we are at the very beginning
  if (cursor === 0 && lines.length > 0) {
    if (lines[0].startsWith('Year,Term') || lines[0].includes('Course Title')) {
      lines.shift();
    }
  }

  logger.info('gpa.resume.processingChunk', { cursor, nextCursor, lineCount: lines.length });
  const { inserted } = await processGpaBatch(db, lines, { leaseOwner });

  // 6. Update state
  await renewGpaMutationLease(db, leaseOwner);
  const reachedEnd = nextCursor >= fullText.length;
  if (reachedEnd) {
    await rebuildAllGpaStats(db, leaseOwner);
  }
  await writeGpaCheckpoint(db, state, {
    id: 'gpa',
    last_sync: currentUnixSeconds(),
    last_status: reachedEnd ? 'complete' : 'running',
    items_synced: (state?.items_synced || 0) + inserted,
    cursor: nextCursor,
    etag: generationEtag,
  });

  if (reachedEnd) {
    await kv.delete(KV_KEY);
  }

  return {
    success: true,
    rowsProcessed: inserted,
    message: reachedEnd
      ? `Processed ${inserted} rows and reached EOF`
      : `Processed ${inserted} rows. Cursor: ${nextCursor}/${fullText.length}`,
    isComplete: reachedEnd,
    completionKey: reachedEnd ? completionKey(generationEtag, nextCursor) : null,
  };
}

async function claimGpaMutationLease(
  db: D1Database,
  purpose: 'resume' | 'reset' | 'publish'
): Promise<string | null> {
  const owner = `${purpose}:${crypto.randomUUID()}`;
  const staleBefore = currentUnixSeconds() - GPA_MUTATION_LEASE_TTL_SECONDS;
  const result = await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), 'running', 0, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
    WHERE sync_state.last_status != 'running'
       OR sync_state.last_sync IS NULL
       OR sync_state.last_sync <= ?
  `).bind(GPA_MUTATION_LEASE_ID, owner, staleBefore).run();
  return d1ChangedRows(result) > 0 ? owner : null;
}

export async function releaseGpaMutationLease(
  db: D1Database,
  owner: string
): Promise<void> {
  await db.prepare(`
    UPDATE sync_state
    SET last_sync = unixepoch(), last_status = 'complete'
    WHERE id = ? AND etag = ? AND last_status = 'running'
  `).bind(GPA_MUTATION_LEASE_ID, owner).run();
}

async function renewGpaMutationLease(
  db: D1Database,
  owner: string
): Promise<void> {
  const result = await db.prepare(`
    UPDATE sync_state
    SET last_sync = unixepoch()
    WHERE id = ? AND etag = ? AND last_status = 'running'
  `).bind(GPA_MUTATION_LEASE_ID, owner).run();
  if (d1ChangedRows(result) !== 1) {
    throw new Error('GPA mutation lease ownership changed; refusing stale data write');
  }
}

async function writeGpaCheckpoint(
  db: D1Database,
  expected: SyncState | null,
  next: SyncState
): Promise<void> {
  const result = await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
    WHERE COALESCE(sync_state.cursor, 0) = ?
      AND sync_state.etag IS ?
      AND sync_state.last_status IS ?
  `).bind(
    next.id,
    next.last_sync,
    next.last_status,
    next.items_synced,
    next.cursor,
    next.etag,
    expected?.cursor ?? 0,
    expected?.etag ?? null,
    expected?.last_status ?? null
  ).run();

  if (d1ChangedRows(result) !== 1) {
    throw new Error('GPA checkpoint changed concurrently; refusing cursor overwrite');
  }
}

/**
 * Atomically claims enrichment for one completed dataset generation.
 *
 * The separate sync_state row makes completion enrichment exactly-once during
 * normal operation, retryable after a recorded failure, and recoverable if a
 * Worker disappears while holding the claim.
 */
export async function claimGpaCompletionEnrichment(
  db: D1Database,
  key: string
): Promise<boolean> {
  const staleBefore = currentUnixSeconds() - GPA_ENRICHMENT_CLAIM_TTL_SECONDS;
  const result = await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), 'running', 0, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
    WHERE sync_state.etag IS NOT excluded.etag
       OR sync_state.last_status IN ('pending', 'failed')
       OR (
         sync_state.last_status = 'running'
         AND (sync_state.last_sync IS NULL OR sync_state.last_sync <= ?)
       )
  `).bind(GPA_ENRICHMENT_STATE_ID, key, staleBefore).run();

  return d1ChangedRows(result) > 0;
}

export async function claimGpaCompletionPublication(
  db: D1Database,
  key: string
): Promise<string | null> {
  const leaseOwner = await claimGpaMutationLease(db, 'publish');
  if (!leaseOwner) return null;

  try {
    const state = await getSyncState(db, 'gpa');
    const currentKey = state?.last_status === 'complete'
      ? completionKey(state.etag, state.cursor ?? 0)
      : null;
    if (currentKey !== key || !await claimGpaCompletionEnrichment(db, key)) {
      await releaseGpaMutationLease(db, leaseOwner);
      return null;
    }
    return leaseOwner;
  } catch (error) {
    await releaseGpaMutationLease(db, leaseOwner);
    throw error;
  }
}

export async function finishGpaCompletionEnrichment(
  db: D1Database,
  key: string,
  status: 'complete' | 'failed'
): Promise<void> {
  await db.prepare(`
    UPDATE sync_state
    SET last_sync = unixepoch(),
        last_status = ?,
        items_synced = CASE WHEN ? = 'complete' THEN 1 ELSE 0 END
    WHERE id = ? AND etag = ? AND last_status = 'running'
  `).bind(status, status, GPA_ENRICHMENT_STATE_ID, key).run();
}

/**
 * Checks for updates using ETag and resets the sync cursor if data has changed.
 * Returns 'skipped_no_changes' or 'reset_initiated'.
 */
export async function resetGpaSync(db: D1Database, kv: KVNamespace): Promise<GpaResetResult> {
  logger.info('gpa.reset.checkingForUpdates');

  // 1. Check current ETag from JSDelivr
  const response = await fetch(GPA_DATASET_URL, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`Failed to check GPA dataset: ${response.status} ${response.statusText}`);
  }

  const newEtag = response.headers.get('etag');
  if (!newEtag) {
    logger.warn('gpa.reset.missingEtag');
  }

  const leaseOwner = await claimGpaMutationLease(db, 'reset');
  if (!leaseOwner) {
    logger.warn('gpa.reset.skippedBusy');
    return 'skipped_busy';
  }

  try {
    // Check state only after owning the mutation lease so a resume cannot
    // advance or complete the generation between comparison and reset.
    const state = await getSyncState(db, 'gpa');
    const currentEtag = state?.etag;

    if (newEtag && currentEtag === newEtag) {
      logger.info('gpa.reset.skippedNoChanges');
      return 'skipped_no_changes';
    }

    logger.info('gpa.reset.changeDetected', {
      hadCurrentEtag: Boolean(currentEtag),
      hasNewEtag: Boolean(newEtag),
    });

    await kv.delete(KV_KEY);
    const generationEtag = newEtag
      ?? `unversioned:${Date.now()}:${crypto.randomUUID()}`;
    await db.batch([
      // gpa_stats is referenced by an immediate FK without ON DELETE behavior.
      // Null dependent links in the same transaction before replacing the
      // generation so the reset is both FK-safe and all-or-nothing.
      db.prepare('UPDATE instructor_course_links SET gpa_id = NULL WHERE gpa_id IS NOT NULL'),
      // Do not leave course-level GPA and quality values from the prior
      // generation visible while its source rows and instructor links are
      // unavailable. Instructor difficulty is RMP-only and remains valid.
      db.prepare(`
        UPDATE courses
        SET avg_gpa = NULL,
            gpa_sample_size = NULL,
            quality_score = NULL,
            updated_at = unixepoch()
        WHERE avg_gpa IS NOT NULL
           OR gpa_sample_size IS NOT NULL
           OR quality_score IS NOT NULL
      `),
      db.prepare('DELETE FROM gpa_source_rows'),
      db.prepare('DELETE FROM gpa_stats'),
      db.prepare(`
        INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
        VALUES ('gpa', NULL, 'pending', 0, 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_sync = excluded.last_sync,
          last_status = excluded.last_status,
          items_synced = excluded.items_synced,
          cursor = excluded.cursor,
          etag = excluded.etag
      `).bind(generationEtag),
    ]);

    return 'reset_initiated';
  } finally {
    await releaseGpaMutationLease(db, leaseOwner);
  }
}

/**
 * Processor: parses lines and persists source provenance only.
 *
 * Aggregate publication happens once at durable EOF, avoiding repeated
 * delete-and-aggregate work for every 50 KiB chunk.
 * Kept local to avoid dispatch overhead.
 */
export async function processGpaBatch(
  db: D1Database,
  lines: string[],
  options: { leaseOwner?: string } = {}
): Promise<{ inserted: number }> {
  const parsedRecords: Array<Omit<GpaRecord, 'rowKey'> & { sourceLine: string }> = [];

  for (const line of lines) {
    const parts = parseCsvLine(line);

    // Check if we have enough parts (23 columns in latest format)
    if (parts.length < 20) continue;

    const subject = parts[3];
    const number = parts[4];
    const instructorRaw = parts[parts.length - 1]; // Last column is instructor
    const sourceYear = Number.parseInt(parts[0], 10);
    const sourceTerm = parts[1]?.trim().toLowerCase();
    if (!Number.isInteger(sourceYear) || !sourceTerm) continue;

    // Parse grades
    let totalPoints = 0;
    let totalStudents = 0;

    const gradeIndices: Record<number, string> = {
      7: 'A+', 8: 'A', 9: 'A-',
      10: 'B+', 11: 'B', 12: 'B-',
      13: 'C+', 14: 'C', 15: 'C-',
      16: 'D+', 17: 'D', 18: 'D-',
      19: 'F'
    };

    for (const [indexStr, grade] of Object.entries(gradeIndices)) {
      const index = parseInt(indexStr);
      const count = parseInt(parts[index]) || 0;
      const weight = WEIGHTS[grade];

      totalPoints += count * weight;
      totalStudents += count;
    }

    if (totalStudents > 0) {
      parsedRecords.push({
        sourceLine: line,
        sourceYear,
        sourceTerm,
        subject,
        number,
        instructor: normalizeInstructor(instructorRaw),
        avgGpa: parseFloat((totalPoints / totalStudents).toFixed(2)),
        sampleSize: totalStudents
      });
    }
  }

  const records = await Promise.all(parsedRecords.map(async ({ sourceLine, ...record }): Promise<GpaRecord> => ({
    ...record,
    rowKey: await hashCsvLine(sourceLine),
  })));

  // Batch insert into D1
  if (records.length === 0) return { inserted: 0 };

  // Use smaller chunks for D1 inserts to avoid parameter limits (100 params max)
  const chunks = chunkArray(records, D1_BATCH_SIZE);
  let totalInserted = 0;

  for (const chunk of chunks) {
    if (options.leaseOwner) {
      await renewGpaMutationLease(db, options.leaseOwner);
    }
    const statements = chunk.map(r => {
      return db.prepare(`
        INSERT INTO gpa_source_rows (
          row_key, source_year, source_term, subject, number, instructor,
          avg_gpa, sample_size, last_updated
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(row_key) DO UPDATE SET
          source_year = excluded.source_year,
          source_term = excluded.source_term,
          subject = excluded.subject,
          number = excluded.number,
          instructor = excluded.instructor,
          avg_gpa = excluded.avg_gpa,
          sample_size = excluded.sample_size,
          last_updated = excluded.last_updated
      `).bind(
        r.rowKey,
        r.sourceYear,
        r.sourceTerm,
        r.subject,
        r.number,
        r.instructor,
        r.avgGpa,
        r.sampleSize
      );
    });

    try {
      await db.batch(statements);
      totalInserted += chunk.length;
    } catch (err) {
      logger.error('gpa.worker.batchInsertFailed', { ...errorFields(err) });
      // We throw here because we want the whole Range Chunk to fail and retry
      // We don't want to skip data in the stream.
      throw err;
    }
  }

  return { inserted: totalInserted };
}

export async function rebuildAllGpaStats(
  db: D1Database,
  leaseOwner: string,
): Promise<void> {
  await renewGpaMutationLease(db, leaseOwner);
  const leasePredicate = `
    EXISTS (
      SELECT 1
      FROM sync_state
      WHERE id = ?
        AND etag = ?
        AND last_status = 'running'
    )
  `;
  const deleteStats = db.prepare(`
    DELETE FROM gpa_stats
    WHERE ${leasePredicate}
  `).bind(GPA_MUTATION_LEASE_ID, leaseOwner);
  const insertStats = db.prepare(`
    INSERT INTO gpa_stats (
      subject, number, instructor, avg_gpa, sample_size, last_updated
    )
    SELECT
      subject,
      number,
      instructor,
      CAST(SUM(avg_gpa * sample_size) AS REAL) / SUM(sample_size) AS avg_gpa,
      SUM(sample_size) AS sample_size,
      unixepoch() AS last_updated
    FROM gpa_source_rows
    WHERE ${leasePredicate}
    GROUP BY subject, number, instructor
  `).bind(GPA_MUTATION_LEASE_ID, leaseOwner);

  await db.batch([deleteStats, insertStats]);
  await renewGpaMutationLease(db, leaseOwner);
}

function d1ChangedRows(result: D1Result<unknown>): number {
  return typeof result.meta?.changes === 'number' ? result.meta.changes : 0;
}

// Helper: Handle CSV quotes properly (e.g. "Smith, John")
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Preserve the source's full instructor identity. Initial-based normalization
// collapses distinct people and no longer joins to full Course Explorer names.
function normalizeInstructor(raw: string): string | null {
  const clean = raw.replace(/"/g, '').trim().replace(/\s+/g, ' ');
  if (!clean) return null;

  const comma = clean.indexOf(',');
  if (comma < 0) return clean;
  const last = clean.slice(0, comma).trim();
  const givenNames = clean.slice(comma + 1).trim();
  if (!last) return givenNames || null;
  return givenNames ? `${last}, ${givenNames}` : last;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
