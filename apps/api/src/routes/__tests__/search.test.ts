import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../search.js';
import { SearchPipeline } from '../../services/search-pipeline.js';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import type { SearchResponseDto } from '@uiuc-course-search/query-types';

vi.mock('../../services/search-pipeline.js');

type SearchRouteBindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

describe('Search Routes', () => {
  let app: Hono<{ Bindings: SearchRouteBindings }>;
  let mockDB: D1Database;
  let mockVectorize: VectorizeIndex;
  let mockAI: Ai;

  beforeEach(() => {
    mockDB = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;
    mockVectorize = {} as unknown as VectorizeIndex;
    mockAI = {} as unknown as Ai;
    
    app = new Hono();
    app.route('/', searchRoutes);
    vi.clearAllMocks();
  });

  it('GET /api/search should use SearchPipeline', async () => {
    const mockResults = [
      {
        course: { id: 'CS-225', subject: 'CS', number: '225', title: 'Data Structures' },
        score: 0.9,
        semanticRank: 1,
        keywordRank: 1,
        termPriority: 0,
        historical: false
      }
    ];

    const mockPipelineResult = {
      results: mockResults,
      meta: {
        query: { raw: 'CS 225', residual: '' },
        extraction: { hints: [] },
        plan: { filters: {}, semanticQuery: '', keywordQuery: '' },
        timing: { extraction_ms: 10, search_ms: 20, total_ms: 30 }
      }
    };

    const searchSpy = vi.fn().mockResolvedValue(mockPipelineResult);
    vi.mocked(SearchPipeline).mockImplementation(() => ({
      search: searchSpy
    }) as unknown as SearchPipeline);

    const res = await app.request('/api/search?q=CS+225', {}, {
      DB: mockDB,
      VECTORIZE: mockVectorize,
      AI: mockAI
    }, {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn()
    } as unknown as ExecutionContext);

    if (res.status !== 200) {
      console.error(await res.text());
    }

    expect(res.status).toBe(200);
    const data = await res.json() as SearchResponseDto;
    expect(data.results).toBeDefined();
    expect(data.results[0].id).toBe('CS-225');
    expect(searchSpy).toHaveBeenCalledWith('CS 225', 20, {}, expect.any(Function));
  });

  it('rejects malformed public search params before running search', async () => {
    const searchSpy = vi.fn();
    vi.mocked(SearchPipeline).mockImplementation(() => ({
      search: searchSpy
    }) as unknown as SearchPipeline);

    const res = await app.request('/api/search?q=cs&limit=999999', {}, {
      DB: mockDB,
      VECTORIZE: mockVectorize,
      AI: mockAI
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be between 1 and 50' });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('normalizes bounded manual search filters', async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: 'systems', residual: 'systems' },
        extraction: { hints: [] },
        plan: { filters: {}, semanticQuery: 'systems', keywordQuery: 'systems' },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 }
      }
    });
    vi.mocked(SearchPipeline).mockImplementation(() => ({
      search: searchSpy
    }) as unknown as SearchPipeline);

    const res = await app.request('/api/search?q=systems&subject=cs&credits=4&difficulty=easy', {}, {
      DB: mockDB,
      VECTORIZE: mockVectorize,
      AI: mockAI
    }, {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn()
    } as unknown as ExecutionContext);

    expect(res.status).toBe(200);
    expect(searchSpy).toHaveBeenCalledWith(
      'systems',
      20,
      { subject: 'CS', credits: 4, difficulty: 'easy' },
      expect.any(Function)
    );
  });
});
