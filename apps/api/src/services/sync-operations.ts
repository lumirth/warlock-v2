import type { Ai, D1Database, Fetcher, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import type { TermState, TermStateStatus } from '../db/types.js';

export type SyncRouteBindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SELF: Fetcher;
  GPA_CACHE: KVNamespace;

  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;

  SYNC_CONCURRENCY: string;
  SYNC_EMBEDDINGS?: string;
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

type TermAggregateCounts = {
  subjectsCount: number;
  coursesCount: number;
  sectionsCount: number;
};

export function resolveManualSyncTermStatus(
  existingTerm: Pick<TermState, 'status'> | null,
  requestedStatus?: TermStateStatus
): TermStateStatus {
  if (requestedStatus) return requestedStatus;
  if (existingTerm?.status) return existingTerm.status;
  return 'active';
}

export function syncEmbeddingsEnabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

export function parseForceRunningLocks(value: string | undefined): boolean | null {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function refreshedSubjectCount(result: { subjectResults: Array<{ success: boolean; skipped?: boolean }> }): number {
  return result.subjectResults.filter(subject => subject.success && !subject.skipped).length;
}

export async function readTermAggregateCounts(
  db: D1Database,
  termId: string,
  year: number,
  term: string,
  totalSubjects: number
): Promise<TermAggregateCounts> {
  const [courses, sections] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM courses
      WHERE year = ? AND term = ?
    `).bind(year, term).first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM sections
      WHERE term_id = ?
    `).bind(termId).first<{ count: number }>(),
  ]);

  return {
    subjectsCount: totalSubjects,
    coursesCount: numericCount(courses?.count),
    sectionsCount: numericCount(sections?.count),
  };
}

function numericCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
