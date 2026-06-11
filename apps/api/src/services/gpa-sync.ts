import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { getSyncState, upsertSyncState } from '../db/sync-state-repository.js';
import { errorFields, logger } from '../observability/logger.js';

const GPA_DATASET_URL = 'https://cdn.jsdelivr.net/gh/wadefagen/datasets@main/gpa/uiuc-gpa-dataset.csv';
// 50K chars is safe for 10ms CPU limit (approx 500 lines)
const CHUNK_SIZE_CHARS = 50 * 1024;
const D1_BATCH_SIZE = 15;
const KV_KEY = 'gpa_full_dataset';

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
  subject: string;
  number: string;
  instructor: string | null;
  avgGpa: number;
  sampleSize: number;
}

interface SyncResult {
  success: boolean;
  rowsProcessed: number;
  message: string;
  isComplete: boolean;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashCsvLine(line: string): string {
  let hash = 2166136261;
  for (let index = 0; index < line.length; index += 1) {
    hash ^= line.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function ensureGpaSourceTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gpa_source_rows (
      row_key TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      number TEXT NOT NULL,
      instructor TEXT,
      avg_gpa REAL NOT NULL,
      sample_size INTEGER NOT NULL,
      last_updated INTEGER
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_gpa_source_rows_course_instructor
    ON gpa_source_rows(subject, number, instructor)
  `).run();
}

/**
 * Resumes GPA sync using KV-cached dataset to allow reliable slicing.
 * Bypasses external HTTP Range/Compression issues.
 */
export async function resumeGpaSync(db: D1Database, kv: KVNamespace): Promise<SyncResult> {
  // 1. Get current cursor
  const state = await getSyncState(db, 'gpa');
  const cursor = state?.cursor || 0;

  logger.info('gpa.resume.start', { cursor });

  // 2. Get Data (Cache-First)
  let fullText = await kv.get(KV_KEY, 'text');

  if (!fullText) {
    logger.info('gpa.resume.cacheMiss');
    const response = await fetch(GPA_DATASET_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch GPA dataset: ${response.status} ${response.statusText}`);
    }

    fullText = await response.text();
    if (!fullText) {
      throw new Error('Fetched empty dataset');
    }

    // Cache for 2 hours (plenty of time to sync)
    await kv.put(KV_KEY, fullText, { expirationTtl: 7200 });
    logger.info('gpa.resume.cachedDataset', { characters: fullText.length });
  }

  // 3. Check for completion
  if (cursor >= fullText.length) {
    logger.info('gpa.resume.complete', { cursor });
    await kv.delete(KV_KEY); // Cleanup

    await upsertSyncState(db, {
      id: 'gpa',
      last_sync: currentUnixSeconds(),
      last_status: 'completed',
      items_synced: (state?.items_synced || 0),
      cursor: cursor, // Keep cursor at end
      etag: state?.etag || null
    });

    return {
      success: true,
      rowsProcessed: 0,
      message: 'Sync Complete (EOF)',
      isComplete: true
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
  const { inserted } = await processGpaBatch(db, lines);

  // 6. Update state
  await upsertSyncState(db, {
    id: 'gpa',
    last_sync: currentUnixSeconds(),
    last_status: 'in_progress',
    items_synced: (state?.items_synced || 0) + inserted,
    cursor: nextCursor,
    etag: state?.etag || null
  });

  return {
    success: true,
    rowsProcessed: inserted,
    message: `Processed ${inserted} rows. Cursor: ${nextCursor}/${fullText.length}`,
    isComplete: false
  };
}

/**
 * Checks for updates using ETag and resets the sync cursor if data has changed.
 * Returns 'skipped_no_changes' or 'reset_initiated'.
 */
export async function resetGpaSync(db: D1Database, kv: KVNamespace): Promise<string> {
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

  // 2. Check stored ETag
  const state = await getSyncState(db, 'gpa');
  const currentEtag = state?.etag;

  // 3. Compare (only skip if we have a completed sync with matching ETag)
  if (newEtag && currentEtag === newEtag && state?.last_status === 'completed') {
    logger.info('gpa.reset.skippedNoChanges');
    return 'skipped_no_changes';
  }

  logger.info('gpa.reset.changeDetected', { hadCurrentEtag: Boolean(currentEtag), hasNewEtag: Boolean(newEtag) });

  // 4. Reset
  await kv.delete(KV_KEY);
  await ensureGpaSourceTable(db);
  await db.prepare('DELETE FROM gpa_source_rows').run();
  await db.prepare('DELETE FROM gpa_stats').run();
  await upsertSyncState(db, {
    id: 'gpa',
    last_sync: null,
    last_status: 'pending',
    items_synced: 0,
    cursor: 0,
    etag: newEtag || null
  });

  return 'reset_initiated';
}

/**
 * Processor: Parses lines and batch-inserts into D1.
 * Kept local to avoid dispatch overhead.
 */
export async function processGpaBatch(db: D1Database, lines: string[]): Promise<{ inserted: number }> {
  const records: GpaRecord[] = [];

  for (const line of lines) {
    const parts = parseCsvLine(line);

    // Check if we have enough parts (23 columns in latest format)
    if (parts.length < 20) continue;

    const subject = parts[3];
    const number = parts[4];
    const instructorRaw = parts[parts.length - 1]; // Last column is instructor

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
      records.push({
        rowKey: hashCsvLine(line),
        subject,
        number,
        instructor: normalizeInstructor(instructorRaw),
        avgGpa: parseFloat((totalPoints / totalStudents).toFixed(2)),
        sampleSize: totalStudents
      });
    }
  }

  // Batch insert into D1
  if (records.length === 0) return { inserted: 0 };
  await ensureGpaSourceTable(db);

  // Use smaller chunks for D1 inserts to avoid parameter limits (100 params max)
  const chunks = chunkArray(records, D1_BATCH_SIZE);
  let totalInserted = 0;

  for (const chunk of chunks) {
    const statements = chunk.map(r => {
      return db.prepare(`
        INSERT INTO gpa_source_rows (row_key, subject, number, instructor, avg_gpa, sample_size, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(row_key) DO UPDATE SET
          subject = excluded.subject,
          number = excluded.number,
          instructor = excluded.instructor,
          avg_gpa = excluded.avg_gpa,
          sample_size = excluded.sample_size,
          last_updated = excluded.last_updated
      `).bind(r.rowKey, r.subject, r.number, r.instructor, r.avgGpa, r.sampleSize);
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

  const affectedGroups = new Map<string, Pick<GpaRecord, 'subject' | 'number' | 'instructor'>>();
  for (const record of records) {
    affectedGroups.set(`${record.subject}\0${record.number}\0${record.instructor ?? ''}`, {
      subject: record.subject,
      number: record.number,
      instructor: record.instructor,
    });
  }

  for (const group of affectedGroups.values()) {
    await db.prepare(`
      DELETE FROM gpa_stats
      WHERE subject = ?
        AND number = ?
        AND ((instructor IS NULL AND ? IS NULL) OR instructor = ?)
    `).bind(group.subject, group.number, group.instructor, group.instructor).run();

    await db.prepare(`
      INSERT INTO gpa_stats (subject, number, instructor, avg_gpa, sample_size, last_updated)
      SELECT
        subject,
        number,
        instructor,
        CAST(SUM(avg_gpa * sample_size) AS REAL) / SUM(sample_size) AS avg_gpa,
        SUM(sample_size) AS sample_size,
        unixepoch() AS last_updated
      FROM gpa_source_rows
      WHERE subject = ?
        AND number = ?
        AND ((instructor IS NULL AND ? IS NULL) OR instructor = ?)
      GROUP BY subject, number, instructor
    `).bind(group.subject, group.number, group.instructor, group.instructor).run();
  }

  return { inserted: totalInserted };
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

// Helper: Normalize instructor name to match "Last, F" or keep as is if needed
function normalizeInstructor(raw: string): string | null {
  // Input: "Geng, Zhe" or "Fagen-Ulmschnei, Wade A"
  // Output: "Geng, Z" or "Fagen-Ulmschnei, W"
  const clean = raw.replace(/"/g, '').trim();
  if (!clean) return null;

  const parts = clean.split(',');
  if (parts.length < 2) return clean; // Fallback

  const last = parts[0].trim();
  const first = parts[1].trim();

  if (!first) return last;

  return `${last}, ${first.charAt(0)}`;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
