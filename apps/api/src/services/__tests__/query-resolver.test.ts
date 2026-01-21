import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('course_code hints', () => {
    it('sets subject and number filters from course_code hint', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 'CS', name: 'Computer Science' }),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'CS 225',
        hints: [{
          type: 'course_code',
          value: 'CS 225',
          confidence: 0.95,
          metadata: { subject: 'CS', number: '225' }
        }],
        residual: ''
      };

      const plan = await resolveQuery(mockDb as any, extracted);

      expect(plan.filters.subject).toBe('CS');
      expect(plan.filters.number).toBe('225');
    });

    it('validates subject exists in database', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'XYZ 999',
        hints: [{
          type: 'course_code',
          value: 'XYZ 999',
          confidence: 0.95,
          metadata: { subject: 'XYZ', number: '999' }
        }],
        residual: ''
      };

      const plan = await resolveQuery(mockDb as any, extracted);

      // Should NOT set filters if subject invalid
      expect(plan.filters.subject).toBeUndefined();
      expect(plan.filters.number).toBeUndefined();
      // Query should fall back to semantic search
      expect(plan.semanticQuery).toBe('XYZ 999');
    });
  });

  describe('instructor hints', () => {
    it('resolves instructor hint to ID', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [{ id: 123, match_score: 0.9 }] }),
        first: vi.fn()
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
  });

  describe('gened hints', () => {
    it('handles gened hints', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

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

  describe('crn hints', () => {
    it('handles CRN hints', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: '12345',
        hints: [{ type: 'crn', value: '12345', confidence: 0.7 }],
        residual: ''
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.crn).toBe('12345');
    });
  });
});
