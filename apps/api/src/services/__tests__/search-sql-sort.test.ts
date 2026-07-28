import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import {
  courseSqlOrderBy,
  orderRetrievedCandidatesByCourseSort,
} from '../search-sql-sort.js';

describe('course SQL sort', () => {
  it('keeps unknown values last and relevance as the deterministic tie-breaker', () => {
    expect(
      courseSqlOrderBy(
        { field: 'gpa', direction: 'desc' },
        'fts_score ASC',
      ),
    ).toBe(
      '(c.avg_gpa) IS NULL ASC, c.avg_gpa DESC, fts_score ASC',
    );
  });

  it('orders the fused lane union before its bounded hydration window', async () => {
    const candidates = [
      { id: 'duplicate-lower', score: 0.9 },
      { id: 'unique-higher', score: 0.8 },
      { id: 'unknown', score: 0.7 },
    ];
    const db = {
      prepare: vi.fn((sql: string) => {
        expect(sql).toContain('c.avg_gpa AS sort_value');
        return {
          bind: vi.fn((...ids: string[]) => {
            expect(ids).toEqual(candidates.map(({ id }) => id));
            return {
              all: vi.fn(async () => ({
                results: [
                  { id: 'duplicate-lower', sort_value: 3.1 },
                  { id: 'unique-higher', sort_value: 3.9 },
                  { id: 'unknown', sort_value: null },
                ],
              })),
            };
          }),
        };
      }),
    };

    await expect(
      orderRetrievedCandidatesByCourseSort(
        db as unknown as D1Database,
        candidates,
        { field: 'gpa', direction: 'desc' },
      ),
    ).resolves.toEqual([
      { id: 'unique-higher', score: 0.8 },
      { id: 'duplicate-lower', score: 0.9 },
      { id: 'unknown', score: 0.7 },
    ]);
  });
});
