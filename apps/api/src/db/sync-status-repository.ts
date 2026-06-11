import type { D1Database } from '@cloudflare/workers-types';
import type { SyncState, TermState, TermStateStatus } from './types.js';

export type EnrichmentCoverageRow = {
  term_id: string;
  status: TermStateStatus;
  courses_count: number | null;
  sections_count: number | null;
  courses_with_gpa: number;
  courses_with_quality: number;
  courses_with_difficulty: number;
  enriched_links: number;
};

type SyncStatusSnapshot = {
  syncStates: SyncState[];
  termStates: TermState[];
  enrichmentCoverage: EnrichmentCoverageRow[];
};

export async function readSyncStatusSnapshot(
  db: D1Database,
): Promise<SyncStatusSnapshot> {
  const [syncStates, termStates, enrichmentCoverage] = await Promise.all([
    listSyncStates(db),
    listTermStates(db),
    listEnrichmentCoverage(db),
  ]);

  return {
    syncStates,
    termStates,
    enrichmentCoverage,
  };
}

async function listSyncStates(db: D1Database): Promise<SyncState[]> {
  const result = await db.prepare(`
    SELECT id, last_sync, last_status, items_synced, cursor, etag
    FROM sync_state
    ORDER BY id
  `).all<SyncState>();
  return result.results;
}

async function listTermStates(db: D1Database): Promise<TermState[]> {
  const result = await db.prepare(`
    SELECT term_id, year, term, status, last_checked, last_synced,
           subjects_count, courses_count, sections_count, sync_errors,
           created_at, updated_at
    FROM term_state
    ORDER BY year DESC, term DESC, term_id
  `).all<TermState>();
  return result.results;
}

async function listEnrichmentCoverage(db: D1Database): Promise<EnrichmentCoverageRow[]> {
  const result = await db.prepare(`
    SELECT
      ts.term_id,
      ts.status,
      ts.courses_count,
      ts.sections_count,
      (
        SELECT COUNT(*)
        FROM courses c
        WHERE c.year = ts.year
          AND c.term = ts.term
          AND c.avg_gpa IS NOT NULL
      ) AS courses_with_gpa,
      (
        SELECT COUNT(*)
        FROM courses c
        WHERE c.year = ts.year
          AND c.term = ts.term
          AND c.quality_score IS NOT NULL
      ) AS courses_with_quality,
      (
        SELECT COUNT(*)
        FROM courses c
        WHERE c.year = ts.year
          AND c.term = ts.term
          AND c.difficulty_score IS NOT NULL
      ) AS courses_with_difficulty,
      (
        SELECT COUNT(*)
        FROM instructor_course_links l
        WHERE l.term_id = ts.term_id
          AND (l.gpa_id IS NOT NULL OR l.rmp_id IS NOT NULL)
      ) AS enriched_links
    FROM term_state ts
    WHERE ts.status IN ('registrable', 'active')
    ORDER BY
      CASE ts.status WHEN 'registrable' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      year DESC,
      CASE term WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC
  `).all<EnrichmentCoverageRow>();
  return result.results;
}
