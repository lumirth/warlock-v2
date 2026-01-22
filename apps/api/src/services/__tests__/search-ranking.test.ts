import { describe, it, expect, vi, beforeEach } from 'vitest';
import { keywordSearch } from '../search.js';
import { validateSubject } from '../query-resolver.js';

// Mock query-resolver to control validateSubject behavior
vi.mock('../query-resolver.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    validateSubject: vi.fn(),
  };
});

describe('keywordSearch ranking and expansion', () => {
  const mockDb = {
    prepare: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expands "Computer Science" to include CS subject code', async () => {
    // Mock validateSubject to return 'CS' for 'Computer Science'
    vi.mocked(validateSubject).mockResolvedValue('CS');

    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    const plan = {
      filters: {},
      keywordQuery: 'Computer Science',
      semanticQuery: 'Computer Science',
    };

    await keywordSearch(mockDb as any, plan as any);

    // Verify validateSubject was called
    expect(validateSubject).toHaveBeenCalledWith(mockDb, 'Computer Science');

    // Verify the SQL and parameters
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('courses_fts MATCH ?'));

    // The query should be expanded: "Computer Science" OR CS
    // Note: The implementation uses double quotes for escaping and wraps in quotes
    expect(mockStmt.bind).toHaveBeenCalledWith(
      expect.stringContaining('"Computer Science" OR CS'),
      expect.any(Number) // limit
    );
  });

  it('uses weighted bm25 function in the SQL', async () => {
    vi.mocked(validateSubject).mockResolvedValue(null);

    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    const plan = {
      filters: {},
      keywordQuery: 'machine learning',
      semanticQuery: 'machine learning',
    };

    await keywordSearch(mockDb as any, plan as any);

    // Verify the SQL contains the weighted bm25 call
    // bm25(courses_fts, 10.0, 10.0, 5.0, 1.0, 2.0, 2.0)
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('bm25(courses_fts, 10.0, 10.0, 5.0, 1.0, 2.0, 2.0)'));
  });

  it('sanitizes query by replacing & with "and"', async () => {
    vi.mocked(validateSubject).mockResolvedValue(null);

    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    const plan = {
      filters: {},
      keywordQuery: 'phil of law & state',
      semanticQuery: 'phil of law & state',
    };

    await keywordSearch(mockDb as any, plan as any);

    // Verify sanitization happened before binding
    // The query passed to bind should have & replaced
    const boundQuery = mockStmt.bind.mock.calls[0][0];
    expect(boundQuery).toContain('phil of law and state');
    expect(boundQuery).not.toContain('&');
  });
});
