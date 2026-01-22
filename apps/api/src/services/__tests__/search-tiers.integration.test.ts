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

  it('Tier 1: "CS 225" should return strict match immediately', async () => {
    const query = 'CS 225';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [{
        type: 'courseCode',
        value: { subject: 'CS', number: '225' },
        metadata: { source: 'regex', confidence: 0.95, raw: 'CS 225' }
      }],
      residual: ''
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { subject: 'CS', number: '225' },
      semanticQuery: '',
      keywordQuery: ''
    } as any);

    const mockResults = [{ course: mockCourse({ subject: 'CS', number: '225' }), score: 1.0, termPriority: 0 }];
    vi.mocked(search.hybridSearchWithTermRanking).mockResolvedValue(mockResults as any);

    const result = await pipeline.search(query);

    expect(result.results).toEqual(mockResults);
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(vi.mocked(search.hybridSearchWithTermRanking).mock.calls[0][3].filters).toMatchObject({
      subject: 'CS',
      number: '225'
    });
  });

  it('Tier 2: "CS 400 level" should extract subject and level', async () => {
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

  it('Tier 3: "easy ai classes" should expand topics', async () => {
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

    vi.mocked(topicRegistry.expandTopics).mockReturnValue(['artificial intelligence', 'machine learning']);

    vi.mocked(search.hybridSearchWithTermRanking)
      .mockResolvedValueOnce([{ course: mockCourse({ id: 'AI-101', title: 'Intro to AI' }), score: 0.5, termPriority: 0 }])
      .mockResolvedValueOnce([
        { course: mockCourse({ id: 'AI-101', title: 'Intro to AI' }), score: 0.5, termPriority: 0 },
        { course: mockCourse({ id: 'CS-440', title: 'Artificial Intelligence' }), score: 0.9, termPriority: 0 }
      ]);

    const result = await pipeline.search(query);

    expect(topicRegistry.expandTopics).toHaveBeenCalledWith('ai classes');
    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].course.id).toBe('CS-440');
  });

  it('Tier 4: should KEEP subject filter when broadening search', async () => {
    const query = 'CS 400 level gened:HUM';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [
        { type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } },
        { type: 'level', value: 400, metadata: { source: 'regex', confidence: 0.9, raw: '400' } },
        { type: 'gened', value: 'HUM', metadata: { source: 'regex', confidence: 0.9, raw: 'HUM' } }
      ],
      residual: ''
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { subject: 'CS', level: 400, gened_code: 'HUM' },
      semanticQuery: '',
      keywordQuery: ''
    } as any);

    // Tier 2: 0 results (CS 400 level HUM)
    // Tier 3: No topic expansion
    // Tier 4.1: Broaden by removing level -> 0 results (CS HUM)
    // Tier 4.2: Broaden by removing gened, but KEEPING subject CS -> results
    
    vi.mocked(search.hybridSearchWithTermRanking)
      .mockResolvedValueOnce([]) // Tier 2
      .mockResolvedValueOnce([]) // Tier 4.1 (CS HUM)
      .mockResolvedValueOnce([   // Tier 4.2 (CS)
        { course: mockCourse({ id: 'CS-101', subject: 'CS', title: 'Intro to CS' }), score: 0.7, termPriority: 0 }
      ]);
    
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    const result = await pipeline.search(query);

    expect(search.hybridSearchWithTermRanking).toHaveBeenCalledTimes(3);
    
    // Check filters in last call (Tier 4.2)
    const lastSearchCallFilters = vi.mocked(search.hybridSearchWithTermRanking).mock.calls[2][3].filters;
    expect(lastSearchCallFilters.subject).toBe('CS');
    expect(lastSearchCallFilters.level).toBeUndefined();
    expect(lastSearchCallFilters.gened_code).toBeUndefined();
    
    expect(result.results[0].course.subject).toBe('CS');
  });

  it('Tier 4: should NOT return results from other subjects even if no results in current subject', async () => {
    const query = 'CS nonexistenttopic';
    
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [{ type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } }],
      residual: 'nonexistenttopic'
    } as any);

    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { subject: 'CS' },
      semanticQuery: 'nonexistenttopic',
      keywordQuery: 'nonexistenttopic'
    } as any);

    // Tier 2: 0 results
    // Tier 3: 0 results
    // Tier 4: Broadening... should still have subject: 'CS'
    
    vi.mocked(search.hybridSearchWithTermRanking).mockResolvedValue([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    const result = await pipeline.search(query);

    // Verify all search calls kept the subject
    for (const call of vi.mocked(search.hybridSearchWithTermRanking).mock.calls) {
      expect(call[3].filters.subject).toBe('CS');
    }
  });
});
