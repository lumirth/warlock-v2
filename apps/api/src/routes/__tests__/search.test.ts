import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { searchRoutes } from '../search.js';
import { SearchPipeline } from '../../services/search-pipeline.js';

vi.mock('../../services/search-pipeline.js');

describe('Search Routes', () => {
  let app: Hono<any>;
  let mockDB: any;
  let mockVectorize: any;
  let mockAI: any;

  beforeEach(() => {
    mockDB = { prepare: vi.fn().mockReturnThis(), bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
    mockVectorize = {};
    mockAI = {};
    
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
    (SearchPipeline as any).mockImplementation(() => ({
      search: searchSpy
    }));

    const res = await app.request('/api/search?q=CS+225', {}, {
      DB: mockDB,
      VECTORIZE: mockVectorize,
      AI: mockAI
    });

    if (res.status !== 200) {
      console.error(await res.text());
    }

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.results).toBeDefined();
    expect(data.results[0].id).toBe('CS-225');
    expect(searchSpy).toHaveBeenCalledWith('CS 225', 20, {});
  });
});
