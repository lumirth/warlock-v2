import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hybridSearch, postFilterSemanticResults } from '../search.js';
import * as embeddings from '../embeddings.js';
import { validateSubject } from '../query-resolver.js';
import type { D1Database } from '@cloudflare/workers-types';

// Mock dependencies
const mockDb = {
  prepare: vi.fn(),
};
const mockVectorize = {};
const mockAi = {};

// We need to mock the semantic search function from embeddings.ts
vi.mock('../embeddings.js', () => ({
  searchCourses: vi.fn().mockResolvedValue([]),
}));

// Mock query-resolver to control validateSubject behavior
vi.mock('../query-resolver.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    validateSubject: vi.fn(),
  };
});

describe('hybridSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips semantic search for purely navigational queries (Subject + Number)', async () => {
    const plan = {
      keywordQuery: 'CS 400',
      semanticQuery: 'CS 400',
      filters: {
        subject: 'CS',
        number: '400'
      }
    };

    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    (mockDb.prepare as any).mockReturnValue(mockStmt);

    await hybridSearch(mockDb as any, mockVectorize as any, mockAi as any, plan as any);

    // Expect semanticSearch to NOT be called
    expect(embeddings.searchCourses).not.toHaveBeenCalled();
  });

  it('runs semantic search WITH filters for exploratory queries', async () => {
    const plan = {
      keywordQuery: 'easy ai',
      semanticQuery: 'easy ai',
      filters: {
        subject: 'CS'
      }
    };

    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    (mockDb.prepare as any).mockReturnValue(mockStmt);

    await hybridSearch(mockDb as any, mockVectorize as any, mockAi as any, plan as any);

    // Expect semanticSearch to BE called WITH filters
    expect(embeddings.searchCourses).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'easy ai',
        plan.filters,
        50
    );
  });

  it('promotes "Computer Science" query to strict Subject Filter', async () => {
    vi.mocked(validateSubject).mockResolvedValue('CS');

    const plan = {
      keywordQuery: 'Computer Science',
      semanticQuery: 'Computer Science',
      filters: {}
    };

    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    (mockDb.prepare as any).mockReturnValue(mockStmt);

    await hybridSearch(mockDb as any, mockVectorize as any, mockAi as any, plan as any);

    // Verify validateSubject was checked
    expect(validateSubject).toHaveBeenCalledWith(mockDb, 'Computer Science');

    // Verify semanticSearch was called WITH subject filter
    expect(embeddings.searchCourses).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'Computer Science',
        expect.objectContaining({ subject: 'CS' }),
        50
    );
  });
});

describe('semantic post-filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters semantic results by gened_code', async () => {
    const semanticResults = [
      { id: 'CS-225', score: 0.9 }, // Has HUM
      { id: 'CS-101', score: 0.8 }, // No HUM
    ];

    const filters = { gened_code: 'HUM' };

    // Mock DB response for course details
    (mockDb.prepare as any).mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'CS-225', credit_hours: 4, avg_gpa: 3.5, geneds: 'HUM,QR1' },
            { id: 'CS-101', credit_hours: 3, avg_gpa: 3.8, geneds: 'QR1' },
          ]
        })
      })
    });

    const filtered = await postFilterSemanticResults(mockDb as any, semanticResults, filters as any);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('CS-225');
  });

  it('filters by credit hours', async () => {
    const semanticResults = [
      { id: 'CS-225', score: 0.9 }, // 4 credits
      { id: 'CS-101', score: 0.8 }, // 3 credits
    ];

    const filters = { credits: 3 };

    (mockDb.prepare as any).mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'CS-225', credit_hours: 4, avg_gpa: 3.5, geneds: 'HUM' },
            { id: 'CS-101', credit_hours: 3, avg_gpa: 3.8, geneds: 'QR1' },
          ]
        })
      })
    });

    const filtered = await postFilterSemanticResults(mockDb as any, semanticResults, filters as any);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('CS-101');
  });
});
