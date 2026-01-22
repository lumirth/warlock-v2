import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hybridSearch } from '../search.js';
import * as embeddings from '../embeddings.js';
import * as searchService from '../search.js';
import { validateSubject } from '../query-resolver.js';

// Mock dependencies
const mockDb = {
  prepare: vi.fn(),
};
const mockVectorize = {};
const mockAi = {};

// Spy on internal functions (or mocked imports)
// Since hybridSearch calls functions in the same module (keywordSearch, sectionKeywordSearch),
// and also imports from embeddings.ts.

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

// We can't easily spy on keywordSearch if it's in the same file and called directly,
// unless we move the test to test the module exports or use a specific mocking strategy.
// However, the critical logic to test is the CALL to semanticSearch.

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

    // Mock keyword search (we just need it to not crash)
    // Since we are running the real hybridSearch, it calls the real keywordSearch.
    // We should mock the DB response for keywordSearch.
    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    await hybridSearch(mockDb as any, mockVectorize as any, mockAi as any, plan as any);

    // Expect semanticSearch to NOT be called
    expect(embeddings.searchCourses).not.toHaveBeenCalled();
  });

  it('runs semantic search WITH filters for exploratory queries', async () => {
    const plan = {
      keywordQuery: 'easy ai',
      semanticQuery: 'easy ai',
      filters: {
        subject: 'CS' // Filter exists, but no number -> Not navigational
      }
    };

    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    await hybridSearch(mockDb as any, mockVectorize as any, mockAi as any, plan as any);

    // Expect semanticSearch to BE called WITH filters
    expect(embeddings.searchCourses).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'easy ai',
        plan.filters, // Verify filters are passed
        50
    );
  });

  it('promotes "Computer Science" query to strict Subject Filter', async () => {
    vi.mocked(validateSubject).mockResolvedValue('CS');

    const plan = {
      keywordQuery: 'Computer Science',
      semanticQuery: 'Computer Science',
      filters: {} // No filters initially
    };

    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    await hybridSearch(mockDb as any, mockVectorize as any, mockAi as any, plan as any);

    // Verify validateSubject was checked
    expect(validateSubject).toHaveBeenCalledWith(mockDb, 'Computer Science');

    // Verify semanticSearch was called WITH subject filter
    expect(embeddings.searchCourses).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'Computer Science',
        expect.objectContaining({ subject: 'CS' }), // Filter was added!
        50
    );
  });
});
