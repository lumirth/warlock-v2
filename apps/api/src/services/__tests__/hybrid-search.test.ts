import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildRetrievalPlan,
  buildSearchCandidateBudget,
  hybridSearch,
  keywordSearch,
  normalizeSearchControls,
  postFilterSemanticResults,
  type SearchCandidateBudget,
} from '../search.js';
import * as embeddings from '../embeddings.js';
import { requirementFilter, singleRequirementFilter } from '@uiuc-course-search/query-types';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import type { Course } from '../../db/index.js';
import type { SearchFilters, SearchPlan } from '../search-planner-types.js';

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

describe('hybridSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function retrievalPlan(
    plan: SearchPlan,
    limit = 20,
    budgetOverrides: Partial<SearchCandidateBudget> = {},
  ) {
    const controls = normalizeSearchControls();
    const budget = {
      ...buildSearchCandidateBudget(plan, { limit, offset: 0 }, controls),
      ...budgetOverrides,
    };
    return buildRetrievalPlan(plan, controls, budget);
  }

  it('skips semantic search for purely navigational queries (Subject + Number)', async () => {
    const plan: SearchPlan = {
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
    mockDb.prepare.mockReturnValue(mockStmt);

    await hybridSearch(
      mockDb as unknown as D1Database,
      mockVectorize as unknown as VectorizeIndex,
      mockAi as unknown as Ai,
      await retrievalPlan(plan),
      plan,
    );

    // Expect semanticSearch to NOT be called
    expect(embeddings.searchCourses).not.toHaveBeenCalled();
  });

  it('runs semantic search WITH filters for exploratory queries', async () => {
    const plan: SearchPlan = {
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
    mockDb.prepare.mockReturnValue(mockStmt);

    await hybridSearch(
      mockDb as unknown as D1Database,
      mockVectorize as unknown as VectorizeIndex,
      mockAi as unknown as Ai,
      await retrievalPlan(plan),
      plan,
    );

    // Expect semanticSearch to BE called WITH filters
    expect(embeddings.searchCourses).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'easy ai',
        plan.filters,
        80
    );
  });

  it('does not promote keyword text to a subject filter during retrieval', async () => {
    const plan: SearchPlan = {
      keywordQuery: 'Computer Science',
      semanticQuery: 'Computer Science',
      filters: {}
    };

    const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(mockStmt);

    await hybridSearch(
      mockDb as unknown as D1Database,
      mockVectorize as unknown as VectorizeIndex,
      mockAi as unknown as Ai,
      await retrievalPlan(plan),
      plan,
    );

    expect(embeddings.searchCourses).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'Computer Science',
        {},
        80
    );
    expect(plan.filters).toEqual({});
  });

  it('chunks broad hybrid candidate loading and preserves lane evidence', async () => {
    vi.mocked(embeddings.searchCourses).mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => ({ id: `semantic-${index}`, score: 1 - index / 100 }))
    );

    const courseLoadBindSizes: number[] = [];
    const makeCourse = (id: string): Course => ({
      id,
      subject: 'CS',
      number: '499',
      title: id,
      description: null,
      credit_hours: 3,
      subject_id: 'CS',
      course_info: null,
      degree_attributes: null,
      class_schedule_info: null,
      date_range_text: null,
      registration_notes: null,
      approval_code: null,
      year: 2026,
      term: 'spring',
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: null,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      last_synced: 0,
      created_at: 0,
      updated_at: 0,
    });

    mockDb.prepare.mockImplementation((sql: string) => {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
          if (sql.includes('FROM courses_fts')) {
            return {
              results: Array.from({ length: 50 }, (_, index) => ({ id: `course-${index}`, fts_score: index })),
            };
          }
          if (sql.includes('FROM sections_fts')) {
            return {
              results: Array.from({ length: 50 }, (_, index) => ({ id: `section-${index}`, fts_score: index })),
            };
          }
          if (sql.includes('FROM courses c') && sql.includes('WHERE c.id IN')) {
            courseLoadBindSizes.push(this.params.length);
            return {
              results: this.params.map(param => makeCourse(String(param))),
            };
          }
          return { results: [] };
        },
      };
      return statement;
    });

    const plan: SearchPlan = {
      keywordQuery: 'machine learning',
      semanticQuery: 'machine learning',
      filters: {},
    };

    const results = await hybridSearch(
      mockDb as unknown as D1Database,
      mockVectorize as unknown as VectorizeIndex,
      mockAi as unknown as Ai,
      await retrievalPlan(plan),
      plan,
    );

    expect(results).toHaveLength(80);
    expect(courseLoadBindSizes.length).toBeGreaterThan(1);
    expect(courseLoadBindSizes.every(size => size <= 50)).toBe(true);
    expect(results[0].laneResults?.[0]).toEqual(expect.objectContaining({
      lane: expect.any(String),
      reason: expect.any(String),
    }));
    expect(results[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'retrieval_fusion' }),
    ]));
  });

  it('applies title-match ranking before trimming the candidate pool', async () => {
    vi.mocked(embeddings.searchCourses).mockResolvedValue([
      { id: 'CS-562-2026-fall', score: 0.99 },
    ]);

    const makeCourse = (id: string, title: string): Course => ({
      id,
      subject: 'CS',
      number: id.includes('225') ? '225' : '562',
      title,
      description: null,
      credit_hours: 3,
      subject_id: 'CS',
      course_info: null,
      degree_attributes: null,
      class_schedule_info: null,
      date_range_text: null,
      registration_notes: null,
      approval_code: null,
      year: 2026,
      term: 'fall',
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: null,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      last_synced: 0,
      created_at: 0,
      updated_at: 0,
    });

    mockDb.prepare.mockImplementation((sql: string) => {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
          if (sql.includes('LOWER(c.title) LIKE')) {
            return {
              results: [{ id: 'CS-225-2026-fall', title_rank: 1 }],
            };
          }
          if (sql.includes('FROM courses_fts') || sql.includes('FROM sections_fts')) {
            return { results: [] };
          }
          if (sql.includes('FROM courses c') && sql.includes('WHERE c.id IN')) {
            return {
              results: this.params.map((param) => {
                const id = String(param);
                return id.includes('225')
                  ? makeCourse(id, 'Data Structures')
                  : makeCourse(id, 'Advanced Topics in Security, Privacy, and Machine Learning');
              }),
            };
          }
          return { results: [] };
        },
      };
      return statement;
    });

    const plan: SearchPlan = {
      keywordQuery: 'data structures',
      semanticQuery: 'data structures',
      filters: {},
    };
    const results = await hybridSearch(
      mockDb as unknown as D1Database,
      mockVectorize as unknown as VectorizeIndex,
      mockAi as unknown as Ai,
      await retrievalPlan(plan, 1, {
        executionResultLimit: 1,
        termCandidateLimit: 1,
      }),
      plan,
    );

    expect(results).toHaveLength(1);
    expect(results[0].course.id).toBe('CS-225-2026-fall');
  });
});

describe('keywordSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recalls exact title matches before unrelated FTS matches', async () => {
    const seenSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        seenSql.push(sql);
        return {
          bind: vi.fn((...params: unknown[]) => ({
            all: vi.fn(async () => {
              if (sql.includes('LOWER(c.title) LIKE')) {
                expect(params).toEqual([
                  'data structures',
                  'data structures%',
                  '%data structures%',
                  20,
                ]);
                return { results: [{ id: 'CS-225-2026-fall', title_rank: 1 }] };
              }
              if (sql.includes('courses_fts MATCH')) {
                return {
                  results: [
                    { id: 'ECE-541-2026-fall', fts_score: -1 },
                    { id: 'CS-225-2026-fall', fts_score: 0 },
                  ],
                };
              }
              return { results: [] };
            }),
          })),
        };
      }),
    };

    const results = await keywordSearch(db as unknown as D1Database, {
      filters: {},
      keywordQuery: 'data structures',
      cleanKeywordQuery: 'data structures',
      titleQuery: 'data structures',
    }, 20);

    expect(seenSql.some(sql => sql.includes('LOWER(c.title) LIKE'))).toBe(true);
    expect(results.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: 'CS-225-2026-fall',
        lane: 'official_text',
        rank: 1,
        reason: expect.any(String),
      }),
      expect.objectContaining({
        id: 'ECE-541-2026-fall',
        lane: 'official_text',
        rank: 2,
        rawScore: -1,
        reason: expect.any(String),
      }),
    ]);
  });

  it('does not run title LIKE recall for expanded decision queries', async () => {
    const db = {
      prepare: vi.fn((sql: string) => {
        expect(sql).not.toContain('LOWER(c.title) LIKE');
        return {
          bind: vi.fn(() => ({
            all: vi.fn(async () => ({ results: [] })),
          })),
        };
      }),
    };

    await keywordSearch(db as unknown as D1Database, {
      filters: {},
      keywordQuery: 'class about movies no essays film cinema media documentary television pop culture visual culture papers essays',
      cleanKeywordQuery: 'class about movies no essays film cinema media documentary television pop culture visual culture papers essays',
      titleQuery: '',
    }, 20);
  });
});

describe('semantic post-filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters semantic results by a single requirement code', async () => {
    const semanticResults = [
      { id: 'CS-225', score: 0.9 }, // Has HUM
      { id: 'CS-101', score: 0.8 }, // No HUM
    ];

    const filters: SearchFilters = { requirement: singleRequirementFilter('HUM') };

    // Mock DB response: The query generated by buildFilterClauses + IN clause
    // should only return courses that match the filters.
    // In this mocked scenario, we simulate that the DB found CS-225 matches the filter.
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'CS-225' }
          ]
        })
      })
    });

    const filtered = await postFilterSemanticResults(mockDb as unknown as D1Database, semanticResults, filters);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('CS-225');
  });

  it('filters by credit hours', async () => {
    const semanticResults = [
      { id: 'CS-225', score: 0.9 }, // 4 credits
      { id: 'CS-101', score: 0.8 }, // 3 credits
    ];

    const filters: SearchFilters = { credits: 3 };

    // Simulate DB returning only the 3-credit course
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'CS-101' }
          ]
        })
      })
    });

    const filtered = await postFilterSemanticResults(mockDb as unknown as D1Database, semanticResults, filters);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('CS-101');
  });

  it('filters by any requirement code', async () => {
    const semanticResults = [
      { id: 'CS-225', score: 0.9 }, // Matches
      { id: 'CS-101', score: 0.8 }, // Doesn't match
    ];

    const filters: SearchFilters = { requirement: requirementFilter('any', ['HUM', 'CNW']) };

    // Simulate DB returning matching course
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 'CS-225' }
          ]
        })
      })
    });

    const filtered = await postFilterSemanticResults(mockDb as unknown as D1Database, semanticResults, filters);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('CS-225');
  });
});
