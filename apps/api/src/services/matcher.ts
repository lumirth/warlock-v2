import type { D1Database } from '@cloudflare/workers-types';

export interface InstructorMatch {
  fullName: string; // "Margaret Fleck"
  gpaName: string;  // "Fleck, Margaret"
  gpaId?: number;
  rmpId?: string;
  rmpRating?: number;
  rmpDifficulty?: number;
  avgGpa?: number;
}

export interface MatchContext {
  termId?: string;
  subject: string;
  number: string;
  instructorName: string; // e.g., "Fleck, M" or "Fleck, Margaret"
}

/**
 * Normalizes a GPA instructor name (Last, First Middle) to a search-friendly format (First Last)
 */
export function normalizeGpaToRmpName(gpaName: string): string {
  if (!gpaName.includes(',')) return gpaName;

  const [last, rest] = gpaName.split(',').map(s => s.trim());
  if (!rest) return last;

  // Split rest into first and middle
  const parts = rest.split(/\s+/);
  const first = parts[0];

  // RMP usually uses "First Last"
  return `${first} ${last}`;
}

/**
 * Resolves an instructor by bridging GPA stats and RMP cache.
 *
 * Step 1: Find the full name in GPA stats using subject/number + partial name.
 * Step 2: Use that full name to find RMP data.
 */
export async function resolveInstructor(
  db: D1Database,
  context: MatchContext
): Promise<InstructorMatch | null> {
  const { subject, number, instructorName } = context;

  // 1. Query GPA stats for the bridge
  // We look for instructors teaching this specific course whose name starts with our partial
  // GPA names are usually "Last, First"
  const gpaQuery = `
    SELECT id, instructor, avg_gpa
    FROM gpa_stats
    WHERE subject = ? AND number = ? AND instructor LIKE ?
    ORDER BY sample_size DESC
    LIMIT 1
  `;

  const gpaResult = await db.prepare(gpaQuery)
    .bind(subject, number, `${instructorName}%`)
    .first<{ id: number; instructor: string; avg_gpa: number }>();

  if (!gpaResult || !gpaResult.instructor) {
    // Fallback: Try matching instructor directly in RMP if we have enough info
    // But for now, as per plan, we prioritize the GPA bridge for safety
    return null;
  }

  const gpaName = gpaResult.instructor;
  const rmpSearchName = normalizeGpaToRmpName(gpaName);

  // 2. Query RMP cache for the full name
  const rmpQuery = `
    SELECT rmp_id, rating, difficulty
    FROM rmp_cache
    WHERE instructor_name = ?
    LIMIT 1
  `;

  const rmpResult = await db.prepare(rmpQuery)
    .bind(rmpSearchName)
    .first<{ rmp_id: string; rating: number; difficulty: number }>();

  return {
    fullName: rmpSearchName,
    gpaName: gpaName,
    gpaId: gpaResult.id,
    rmpId: rmpResult?.rmp_id,
    rmpRating: rmpResult?.rating,
    rmpDifficulty: rmpResult?.difficulty,
    avgGpa: gpaResult.avg_gpa
  };
}
