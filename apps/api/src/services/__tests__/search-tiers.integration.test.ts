import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchPipeline } from '../search-pipeline.js';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import * as extractor from '../extractor.js';
import * as queryResolver from '../query-resolver.js';
import * as search from '../search.js';
import * as topicRegistry from '../topic-registry.js';
import type { Course } from '../../db/index.js';

vi.mock('../extractor.js');
vi.mock('../query-resolver.js');
vi.mock('../search.js');
vi.mock('../topic-registry.js');

const mockCourse = (overrides: Partial<Course> = {}): Course => ({
  id: 'CS-225-2025-fall',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data structures and algorithms.',
  credit_hours: 4,
  gened: 'QR',
  year: 2025,
  term: 'fall',
  avg_gpa: 3.5,
  gpa_sample_size: 1000,
  primary_instructor: 'Fagen-Ulmschneider, G',
  primary_instructor_rmp: 4.5,
  difficulty_score: 3.0,
  quality_score: 4.5,
  subject_id: 'CS',
  course_info: null,
  degree_attributes: null,
  class_schedule_info: null,
  date_range_text: null,
  registration_notes: null,
  approval_code: null,
  last_synced: 0,
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

describe('SearchPipeline Tiered Logic Integration', () => {
  let db: D1Database;
  let vectorize: VectorizeIndex;
  let ai: Ai;
  let pipeline: SearchPipeline;

  beforeEach(() => {
    db = { prepare: vi.fn(), batch: vi.fn() } as any;
    vectorize = {} as any;
    ai = {} as any;
    pipeline = new SearchPipeline(db, vectorize, ai);
    vi.clearAllMocks();
  });

  it('Test Case 1 (Tier 1): "CS 225" should return strict match immediately', async () => {
    const query = 'CS 225';
    
    // 1. Mock Extraction
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [{
        type: 'courseCode',
        value: { subject: 'CS', number: '225' },
        metadata: { source: 'regex', confidence: 0.95, raw: 'CS 225' }
      }],
      residual: ''
    } as any);

    // 2. Mock Resolver
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { subject: 'CS', number: '225' },
      semanticQuery: '',
      keywordQuery: ''
    } as any);

    // 3. Mock Search
    const mockResults = [{ course: mockCourse({ subject: 'CS', number: '225' }), score: 1.0, termPriority: 0 }];
    vi.mocked(search.hybridSearchWithTermRanking).mockResolvedValue(mockResults as any);

    const result = await pipeline.search(query);

    expect(result.results).toEqual(mockResults);
    // Should only call search once because it is navigational
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(vi.mocked(search.hybridSearchWithTermRanking).mock.calls[0][3].filters).toMatchObject({
      subject: 'CS',
      number: '225'
    });
  });

  it('Test Case 2 (Tier 2): "CS 400 level" should extract subject and level', async () => {
    const query = 'CS 400 level';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [
        { type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } },
        { type: 'level', value: 400, metadata: { source: 'regex', confidence: 0.9, raw: '400' } }
      ],
      residual: ''
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { subject: 'CS', level: 400 },
      semanticQuery: '',
      keywordQuery: ''
    } as any);

    const mockResults = Array(5).fill(null).map((_, i) => ({ course: mockCourse({ id: `CS-${i}`, subject: 'CS', number: `40${i}` }), score: 0.8, termPriority: 0 }));
    vi.mocked(search.hybridSearchWithTermRanking).mockResolvedValue(mockResults as any);

    const result = await pipeline.search(query);

    expect(result.results).toHaveLength(5);
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(vi.mocked(search.hybridSearchWithTermRanking).mock.calls[0][3].filters).toMatchObject({
      subject: 'CS',
      level: 400
    });
  });

  it('Test Case 3 (Tier 3): "easy ai classes" should expand topics', async () => {
    const query = 'easy ai classes';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [{ type: 'difficulty', value: 'easy', metadata: { source: 'regex', confidence: 0.9, raw: 'easy' } }],
      residual: 'ai classes'
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { difficulty: 'easy' },
      semanticQuery: 'ai classes',
      keywordQuery: 'ai classes'
    } as any);

    // Mock expansion
    vi.mocked(topicRegistry.expandTopics).mockReturnValue(['artificial intelligence', 'machine learning']);

    // First call (Tier 2) returns 1 result (triggering expansion)
    vi.mocked(search.hybridSearchWithTermRanking)
      .mockResolvedValueOnce([{ course: mockCourse({ id: 'AI-101', title: 'Intro to AI' }), score: 0.5, termPriority: 0 }])
      // Second call (Tier 3) returns more results
      .mockResolvedValueOnce([
        { course: mockCourse({ id: 'AI-101', title: 'Intro to AI' }), score: 0.5, termPriority: 0 },
        { course: mockCourse({ id: 'CS-440', title: 'Artificial Intelligence' }), score: 0.9, termPriority: 0 }
      ]);

    const result = await pipeline.search(query);

    expect(topicRegistry.expandTopics).toHaveBeenCalledWith('ai classes');
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].course.id).toBe('CS-440'); // Should be first due to higher score
  });

  it('Test Case 4 (Robustness): "phil of law & state" should handle special characters', async () => {
    // This tests that the pipeline doesn't crash and correctly passes the query through
    // We'll use the real sanitizer check indirectly
    const query = 'phil of law & state';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [],
      residual: 'phil of law & state'
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: 'phil of law & state',
      keywordQuery: 'phil of law & state'
    } as any);

    vi.mocked(search.hybridSearchWithTermRanking).mockResolvedValue([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    // Should NOT throw
    await expect(pipeline.search(query)).resolves.not.toThrow();
    
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalled();
  });

  it('Tier 4: should broaden search if no results found with subject filter', async () => {
    const query = 'CS underwater basket weaving';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [{ type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } }],
      residual: 'underwater basket weaving'
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { subject: 'CS' },
      semanticQuery: 'underwater basket weaving',
      keywordQuery: 'underwater basket weaving'
    } as any);

    // Tier 2: 0 results
    vi.mocked(search.hybridSearchWithTermRanking)
      .mockResolvedValueOnce([]) // Tier 2
      .mockResolvedValueOnce([ // Tier 4 Broadening (removing subject)
        { course: mockCourse({ id: 'ART-101', subject: 'ART', title: 'Basket Weaving' }), score: 0.8, termPriority: 0 }
      ]);
    
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    const result = await pipeline.search(query);

    // Should call search at least twice (Tier 2, then Tier 4 fallback)
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(2);
    expect(result.results[0].course.subject).toBe('ART');
  });
});
