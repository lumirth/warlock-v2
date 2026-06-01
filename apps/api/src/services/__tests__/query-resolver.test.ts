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

  describe('new hint types', () => {
    describe('days hints', () => {
      it('passes days filter through unchanged', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'MWF classes',
          hints: [{ type: 'days', value: 'MWF', confidence: 0.8 }],
          residual: 'classes'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.days).toBe('MWF');
      });
    });

    describe('time hints', () => {
      it('passes time filter through unchanged', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'morning classes',
          hints: [{ type: 'time', value: 'morning', confidence: 0.7 }],
          residual: 'classes'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.time).toBe('morning');
      });
    });

    describe('level hints', () => {
      it('passes numeric level filter', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: '400 level',
          hints: [{ type: 'level', value: '400', confidence: 0.9 }],
          residual: ''
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.level).toBe(400);
      });
    });

    describe('credits hints', () => {
      it('passes credits filter as number', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: '3 credits',
          hints: [{ type: 'credits', value: '3', confidence: 0.8 }],
          residual: ''
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.credits).toBe(3);
      });
    });

    describe('online hints', () => {
      it('converts online hint to boolean true', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'online class',
          hints: [{ type: 'online', value: 'true', confidence: 0.8 }],
          residual: 'class'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.online).toBe(true);
      });

      it('converts in-person hint to boolean false', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'in person class',
          hints: [{ type: 'online', value: 'false', confidence: 0.8 }],
          residual: 'class'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.online).toBe(false);
      });
    });

    describe('status hints', () => {
      it('passes status filter unchanged', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'open sections',
          hints: [{ type: 'status', value: 'open', confidence: 0.7 }],
          residual: 'sections'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.status).toBe('open');
      });
    });

    describe('term hints', () => {
      it('passes structured term and year filters', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'spring 2026 CS',
          hints: [{ type: 'term', value: { term: 'spring', year: 2026 }, confidence: 0.95 }],
          residual: 'CS'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.term).toBe('spring');
        expect(plan.filters.year).toBe(2026);
      });
    });

    describe('difficulty hints', () => {
      it('passes difficulty filter unchanged', async () => {
        const mockStmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        };
        (mockDb.prepare as any).mockReturnValue(mockStmt);

        const extracted: ExtractedQuery = {
          rawQuery: 'easy class',
          hints: [{ type: 'difficulty', value: 'easy', confidence: 0.7 }],
          residual: 'class'
        };

        const plan = await resolveQuery(mockDb as any, extracted);
        expect(plan.filters.difficulty).toBe('easy');
      });
    });
  });
});
