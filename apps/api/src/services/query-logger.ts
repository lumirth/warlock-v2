import type { D1Database } from '@cloudflare/workers-types';
import type { SearchPipelineResult } from './search-pipeline.js';

const SAMPLE_RATE = 0.10;  // 10%

function shouldLog(): boolean {
  return Math.random() < SAMPLE_RATE;
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function logSearch(
  db: D1Database,
  rawQuery: string,
  result: SearchPipelineResult,
  isNavigational: boolean,
  tierReached: number,
  constraintsRelaxed: string[]
): Promise<void> {
  if (!shouldLog()) {
    return;
  }

  const id = generateId();
  const timestamp = Date.now();

  const hintsJson = JSON.stringify(result.meta.extraction.hints);
  const filtersJson = JSON.stringify(result.meta.plan.filters);
  const residual = result.meta.query.residual;

  const resultCount = result.results.length;
  const top5Ids = JSON.stringify(result.results.slice(0, 5).map(r => r.course.id));

  const totalMs = result.meta.timing.total_ms;
  const sampleBucket = Math.floor(Math.random() * 100);

  try {
    await db.prepare(`
      INSERT INTO search_logs (
        id, timestamp, raw_query,
        hints_json, filters_json, residual,
        is_navigational, tier_reached, constraints_relaxed,
        result_count, top5_ids, total_ms, sample_bucket
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, timestamp, rawQuery,
      hintsJson, filtersJson, residual,
      isNavigational ? 1 : 0, tierReached, JSON.stringify(constraintsRelaxed),
      resultCount, top5Ids, totalMs, sampleBucket
    ).run();
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Failed to log search:', error);
  }
}
