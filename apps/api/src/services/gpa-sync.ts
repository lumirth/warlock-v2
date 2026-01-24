import type { D1Database } from '@cloudflare/workers-types';
import { getSyncState, upsertSyncState } from '../db/index.js';

const GPA_DATASET_URL = 'https://raw.githubusercontent.com/wadefagen/datasets/main/gpa/uiuc-gpa-dataset.csv';
// 100KB chunk size is safe for 10ms CPU limit (approx 1000 lines)
const CHUNK_SIZE_BYTES = 100 * 1024;
const D1_BATCH_SIZE = 15; // Rows per SQL statement to stay under 100-param limit

// GPA Weights
const WEIGHTS: Record<string, number> = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.67,
  'B+': 3.33, 'B': 3.0, 'B-': 2.67,
  'C+': 2.33, 'C': 2.0, 'C-': 1.67,
  'D+': 1.33, 'D': 1.0, 'D-': 0.67,
  'F': 0.0
};

interface GpaRecord {
  subject: string;
  number: string;
  instructor: string | null;
  avgGpa: number;
  sampleSize: number;
}

export interface SyncResult {
  success: boolean;
  rowsProcessed: number;
  message: string;
  isComplete: boolean;
}

/**
 * Resumes GPA sync from the last saved cursor using HTTP Range requests.
 * Designed for Cloudflare Workers Free Tier (10ms CPU limit).
 */
export async function resumeGpaSync(db: D1Database): Promise<SyncResult> {
  // 1. Get current cursor
  const state = await getSyncState(db, 'gpa');
  const startOffset = state?.cursor || 0;
  const endOffset = startOffset + CHUNK_SIZE_BYTES;

  console.log(`[GPA Sync] Resuming from byte offset ${startOffset}...`);

  // 2. Fetch chunk using Range header
  const response = await fetch(GPA_DATASET_URL, {
    headers: {
      'Range': `bytes=${startOffset}-${endOffset}`,
      'User-Agent': 'Cloudflare-Worker-GPA-Sync',
      'Accept-Encoding': 'identity'
    }
  });

  // Handle completion (416 Range Not Satisfiable)
  if (response.status === 416) {
    await upsertSyncState(db, {
      id: 'gpa',
      last_sync: Date.now(),
      last_status: 'completed',
      items_synced: (state?.items_synced || 0),
      cursor: startOffset // Keep cursor at end
    });
    return { success: true, rowsProcessed: 0, message: 'Sync already complete (EOF)', isComplete: true };
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch GPA dataset: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text) {
     // Empty body?
     return { success: true, rowsProcessed: 0, message: 'Empty response (EOF?)', isComplete: true };
  }

  // 3. Handle partial lines
  // We must process only up to the last newline to ensure we don't process a truncated line.
  // Unless this is the very end of the file (Content-Range header usually tells us, or text length < requested)
  const contentRange = response.headers.get('content-range'); // "bytes 0-102400/8000000"
  const totalSize = contentRange ? parseInt(contentRange.split('/')[1]) : -1;
  const isEndOfFile = (totalSize !== -1 && endOffset >= totalSize) || text.length < CHUNK_SIZE_BYTES;

  let processText = text;
  let nextCursor = startOffset + text.length;

  // Debug stats
  const debugStats = {
    startOffset,
    textLength: text.length,
    isEndOfFile,
    contentRange: response.headers.get('content-range'),
    chunkSize: CHUNK_SIZE_BYTES
  };

  if (!isEndOfFile) {
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) {
      // Chunk is huge and has no newline? Unlikely for 100KB chunk.
      // But if it happens, we can't process it safely.
      // We might need to fetch a larger chunk or warn.
      throw new Error(`Chunk contains no newlines. Line too long? Stats: ${JSON.stringify(debugStats)}`);
    }
    processText = text.substring(0, lastNewline);
    nextCursor = startOffset + lastNewline + 1; // Start next chunk after the newline
  } else {
    // EOF, process everything
    nextCursor = startOffset + text.length;
  }

  // 4. Parse lines
  const lines = processText.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);

  // Skip header if we are at the very beginning
  if (startOffset === 0 && lines.length > 0) {
    if (lines[0].startsWith('Year,Term') || lines[0].includes('Course Title')) {
      lines.shift();
    }
  }

  // 5. Process lines (Insert to D1)
  const { inserted } = await processGpaBatch(db, lines);

  // 6. Update cursor
  await upsertSyncState(db, {
    id: 'gpa',
    last_sync: Date.now(),
    last_status: isEndOfFile ? 'completed' : 'in_progress',
    items_synced: (state?.items_synced || 0) + inserted,
    cursor: nextCursor
  });

  return {
    success: true,
    rowsProcessed: inserted,
    message: `Processed ${inserted} rows. Cursor moved to ${nextCursor}. ${isEndOfFile ? '(Complete)' : '(Continuing)'}. Debug: ${lines.length} lines parsed. first: ${lines[0]?.substring(0, 20)}...`,
    isComplete: isEndOfFile
  };
}

/**
 * Resets the sync cursor to 0 to restart the process.
 */
export async function resetGpaSync(db: D1Database): Promise<void> {
  await upsertSyncState(db, {
    id: 'gpa',
    last_sync: null,
    last_status: 'pending',
    items_synced: 0,
    cursor: 0
  });
}

/**
 * Processor: Parses lines and batch-inserts into D1.
 * Kept local to avoid dispatch overhead.
 */
async function processGpaBatch(db: D1Database, lines: string[]): Promise<{ inserted: number }> {
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

  // Use smaller chunks for D1 inserts to avoid parameter limits (100 params max)
  const chunks = chunkArray(records, D1_BATCH_SIZE);
  let totalInserted = 0;

  for (const chunk of chunks) {
    const statements = chunk.map(r => {
      // Idempotent UPSERT
      return db.prepare(`
        INSERT INTO gpa_stats (subject, number, instructor, avg_gpa, sample_size, last_updated)
        VALUES (?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(subject, number, instructor) DO UPDATE SET
          avg_gpa = excluded.avg_gpa,
          sample_size = excluded.sample_size,
          last_updated = excluded.last_updated
      `).bind(r.subject, r.number, r.instructor, r.avgGpa, r.sampleSize);
    });

    try {
      await db.batch(statements);
      totalInserted += chunk.length;
    } catch (err) {
      console.error('[GPA Worker] Batch Insert Error:', err);
      // We throw here because we want the whole Range Chunk to fail and retry
      // We don't want to skip data in the stream.
      throw err;
    }
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

/**
 * No-op compatibility export
 */
export async function retryFailedBatches(db: D1Database): Promise<{ recovered: number; remaining: number }> {
    return { recovered: 0, remaining: 0 };
}
