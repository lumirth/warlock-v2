import { describe, it, expect, vi } from 'vitest';
import { resolveQuery } from '../query-resolver.js';
import type { ExtractedQuery } from '@uiuc-course-search/query-types';

const mockDb = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(),
      all: vi.fn()
    }))
  }))
};

describe('resolveQuery', () => {
  it('resolves instructor hint to ID', async () => {
    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [{ id: 123, match_score: 0.9 }] })
    };
    (mockDb.prepare as any).mockReturnValue(mockStmt);

    const extracted: ExtractedQuery = {
      rawQuery: 'cs 225 by fagen',
      hints: [{ type: 'instructor', value: 'fagen', confidence: 0.8 }],
      residual: 'cs 225'
    };

    const plan = await resolveQuery(mockDb as any, extracted);
    expect(plan.filters.instructor_ids).toEqual([123]);
    expect(plan.semanticQuery).toBe('cs 225');
  });

  it('handles gened hints', async () => {
    const extracted: ExtractedQuery = {
      rawQuery: 'easy humanities gened',
      hints: [{ type: 'gened', value: 'humanities', confidence: 0.7 }],
      residual: 'easy'
    };

    const plan = await resolveQuery(mockDb as any, extracted);
    // For now, we expect it to map 'humanities' to a known code or keep it
    expect(plan.filters.gened_code).toBeDefined();
    expect(plan.semanticQuery).toBe('easy');
  });
});
