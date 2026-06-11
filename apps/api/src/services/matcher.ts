import type { D1Database } from '@cloudflare/workers-types';

interface InstructorMatch {
  fullName: string; // "Fleck, M"
  gpaName?: string;  // "Fleck, Margaret"
  gpaId?: number;
  rmpId?: string;
  rmpRating?: number;
  rmpDifficulty?: number;
  avgGpa?: number;
}

interface MatchContext {
  termId?: string;
  subject: string;
  number: string;
  instructorName: string; // e.g., "Fleck, M" or "Fleck, Margaret"
}

/**
 * Normalizes a GPA instructor name (Last, First Middle) to the RMP cache format (Last, F)
 */
export function normalizeToRmpCacheName(name: string): string {
  if (!name.includes(',')) return name;

  const [last, rest] = name.split(',').map(s => s.trim());
  if (!rest) return last;

  // Take the first letter of the first name
  const firstInitial = rest.charAt(0).toUpperCase();
  return `${last}, ${firstInitial}`;
}

/**
 * Resolves an instructor by bridging GPA stats and RMP cache.
 * Falls back to direct RMP match if GPA bridge is missing.
 */
export async function resolveInstructor(
  db: D1Database,
  context: MatchContext
): Promise<InstructorMatch | null> {
  const { subject, number, instructorName } = context;
  const normalizedSearchName = normalizeToRmpCacheName(instructorName);

  // 1. Try GPA Bridge first (provides highest confidence)
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

  if (gpaResult && gpaResult.instructor) {
    const gpaName = gpaResult.instructor;
    const rmpSearchName = normalizeToRmpCacheName(gpaName);

    const rmpResult = await db.prepare(`
      SELECT rmp_id, rating, difficulty
      FROM rmp_cache
      WHERE instructor_name = ?
      LIMIT 1
    `).bind(rmpSearchName).first<{ rmp_id: string; rating: number; difficulty: number }>();

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

  // 2. Fallback: Direct RMP Cache match
  const rmpResult = await db.prepare(`
    SELECT rmp_id, rating, difficulty
    FROM rmp_cache
    WHERE instructor_name = ?
    LIMIT 1
  `).bind(normalizedSearchName).first<{ rmp_id: string; rating: number; difficulty: number }>();

  if (rmpResult) {
    return {
      fullName: normalizedSearchName,
      rmpId: rmpResult.rmp_id,
      rmpRating: rmpResult.rating,
      rmpDifficulty: rmpResult.difficulty
    };
  }

  return null;
}
