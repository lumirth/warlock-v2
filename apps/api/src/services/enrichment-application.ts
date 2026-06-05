import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { enrichCoursesWithGpa, enrichCoursesWithScores, coordinateEnrichment } from './enrichment.js';
import { resumeGpaSync, resetGpaSync } from './gpa-sync.js';
import { coordinateRmpSync, processRmpBatch, type RmpTeacherNode } from './rmp-sync.js';
import type { SyncRouteBindings } from './sync-operations.js';

export type EnrichmentApplicationEnv = Pick<
  SyncRouteBindings,
  'DB' | 'SELF' | 'INTERNAL_TOKEN' | 'RMP_AUTH_TOKEN' | 'GPA_CACHE'
>;

export async function runRmpAndScoringEnrichment(
  env: EnrichmentApplicationEnv
) {
  const result = await coordinateRmpSync(env.DB, env.SELF, {
    rmpAuthToken: env.RMP_AUTH_TOKEN,
    internalToken: env.INTERNAL_TOKEN,
  });
  const enrichment = await coordinateEnrichment(env.DB, env.SELF, env.INTERNAL_TOKEN);
  return { ...result, enrichment };
}

export async function processRmpTeachers(
  db: D1Database,
  teachers: RmpTeacherNode[]
): Promise<{ status: 'complete'; message: string; count: number }> {
  await processRmpBatch(db, teachers);
  return { status: 'complete', message: 'Batch processed', count: teachers.length };
}

export async function runScoringEnrichment(env: Pick<EnrichmentApplicationEnv, 'DB' | 'SELF' | 'INTERNAL_TOKEN'>) {
  const result = await coordinateEnrichment(env.DB, env.SELF, env.INTERNAL_TOKEN);
  return { message: 'Scoring enrichment complete', ...result };
}

export async function runGpaEnrichment(db: D1Database) {
  await enrichCoursesWithGpa(db);
  const scores = await enrichCoursesWithScores(db);
  return { message: 'Enrichment complete', scoreUpdateCount: scores.updated };
}

export async function resetGpaCursor(db: D1Database, cache: KVNamespace) {
  await resetGpaSync(db, cache);
  return { message: 'GPA sync cursor reset to 0.' };
}

export function resumeGpaEnrichment(db: D1Database, cache: KVNamespace) {
  return resumeGpaSync(db, cache);
}
