import { describe, it, expect, vi, beforeEach } from 'vitest';
import { singleRequirementFilter } from '@uiuc-course-search/query-types';
import { SearchPipeline } from '../search-pipeline.js';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import * as extractor from '../extractor.js';
import * as queryResolver from '../query-resolver.js';
import * as searchText from '../search-text.js';
import * as termRanking from '../search-term-ranking.js';
import * as topicRegistry from '../topic-registry.js';
import { normalizeSearchRequest } from '../search-request.js';
import type { Course } from '../../db/index.js';
import type { ExtractionResult } from '../extractor.js';
import type { SearchResult } from '../search.js';
import type { SearchPlan } from '../search-planner-types.js';

vi.mock('../extractor.js');
vi.mock('../query-resolver.js');
vi.mock('../search-text.js');
vi.mock('../search-term-ranking.js');
vi.mock('../topic-registry.js');

function request(query: string) {
  return normalizeSearchRequest({ query });
}

function planFromFirstSearchCall(): SearchPlan {
  return vi.mocked(termRanking.hybridSearchWithTermRanking).mock.calls[0][3]
    .plan;
}

const mockCourse = (overrides: Partial<Course> = {}): Course => ({
  id: 'CS-225-2025-fall',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data structures and algorithms.',
  credit_hours: 4,
  year: 2025,
  term: 'fall',
  avg_gpa: 3.5,
  gpa_sample_size: 1000,
  primary_instructor: 'Fagen-Ulmschneider, G',
  primary_instructor_rmp: 4.5,
  difficulty_score: 35,
  quality_score: 88,
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
    db = { prepare: vi.fn(), batch: vi.fn() } as unknown as D1Database;
    vectorize = {} as unknown as VectorizeIndex;
    ai = {} as unknown as Ai;
    pipeline = new SearchPipeline(db, vectorize, ai);
    vi.clearAllMocks();
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(queryText => queryText);
  });

  it('Tier 1: "CS 225" should return strict match immediately', async () => {
    const query = 'CS 225';
    
    const extraction: ExtractionResult = {
      hints: [{
        type: 'courseCode',
        value: { subject: 'CS', number: '225' },
        metadata: { source: 'regex', confidence: 0.95, raw: 'CS 225' }
      }],
      residual: ''
    };

    const plan: SearchPlan = {
      filters: { subject: 'CS', number: '225' },
      semanticQuery: '',
      keywordQuery: ''
    };

    vi.mocked(extractor.extractQuery).mockReturnValue(extraction);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(plan);
    const mockResults: SearchResult[] = [{ course: mockCourse({ subject: 'CS', number: '225' }), score: 1.0, termPriority: 0 }];
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue(mockResults);

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual(mockResults);
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(planFromFirstSearchCall().filters).toMatchObject({
      subject: 'CS',
      number: '225'
    });
  });

  it('Tier 2: "CS 400 level" should extract subject and level', async () => {
    const query = 'CS 400 level';
    
    const extraction: ExtractionResult = {
      hints: [
        { type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } },
        { type: 'level', value: 400, metadata: { source: 'regex', confidence: 0.9, raw: '400' } }
      ],
      residual: ''
    };

    const plan: SearchPlan = {
      filters: { subject: 'CS', level: 400 },
      semanticQuery: '',
      keywordQuery: ''
    };

    vi.mocked(extractor.extractQuery).mockReturnValue(extraction);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(plan);
    const mockResults: SearchResult[] = Array(5).fill(null).map((_, i) => ({ course: mockCourse({ id: `CS-${i}`, subject: 'CS', number: `40${i}` }), score: 0.8, termPriority: 0 }));
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue(mockResults);

    const result = await pipeline.search(request(query));

    expect(result.results).toHaveLength(5);
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(planFromFirstSearchCall().filters).toMatchObject({
      subject: 'CS',
      level: 400
    });
  });

  it('"easy ai classes" expands topics before the initial search', async () => {
    const query = 'easy ai classes';
    
    const extraction: ExtractionResult = {
      hints: [{ type: 'difficulty', value: 'easy', metadata: { source: 'regex', confidence: 0.9, raw: 'easy' } }],
      residual: 'ai classes'
    };

    const plan: SearchPlan = {
      filters: { difficulty: 'easy' },
      semanticQuery: 'ai classes',
      keywordQuery: 'ai classes'
    };

    vi.mocked(extractor.extractQuery).mockReturnValue(extraction);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(plan);
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(queryText => queryText);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue(['artificial intelligence']);

    vi.mocked(termRanking.hybridSearchWithTermRanking)
      .mockResolvedValueOnce([{ course: mockCourse({ id: 'CS-440', title: 'Artificial Intelligence' }), score: 0.9, termPriority: 0 }]);

    const result = await pipeline.search(request(query));

    expect(topicRegistry.expandTopics).toHaveBeenCalledWith('ai');
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(planFromFirstSearchCall()).toMatchObject({
      filters: { difficulty: 'easy' },
      semanticQuery: 'ai artificial intelligence',
      keywordQuery: 'ai OR artificial OR intelligence',
      softPreferences: { topicExpansions: ['artificial intelligence'] },
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].course.id).toBe('CS-440');
  });

  it('does not broaden by dropping subject, level, or gened hard filters', async () => {
    const query = 'CS 400 level gened:HUM';
    
    const extraction: ExtractionResult = {
      hints: [
        { type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } },
        { type: 'level', value: 400, metadata: { source: 'regex', confidence: 0.9, raw: '400' } },
        { type: 'gened', value: 'HUM', metadata: { source: 'regex', confidence: 0.9, raw: 'HUM' } }
      ],
      residual: ''
    };

    const plan: SearchPlan = {
      filters: { subject: 'CS', level: 400, requirement: singleRequirementFilter('HUM') },
      semanticQuery: '',
      keywordQuery: ''
    };

    vi.mocked(extractor.extractQuery).mockReturnValue(extraction);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(plan);
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValueOnce([]);
    
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    const result = await pipeline.search(request(query));

    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([]);

    const filters = planFromFirstSearchCall().filters;
    expect(filters.subject).toBe('CS');
    expect(filters.level).toBe(400);
    expect(filters.requirement).toEqual(singleRequirementFilter('HUM'));
    expect(result.meta.fallback.constraintsRelaxed).toEqual([]);
  });

  it('does not return results from other subjects when exact subject search is empty', async () => {
    const query = 'CS nonexistenttopic';
    
    const extraction: ExtractionResult = {
      hints: [{ type: 'subject', value: 'CS', metadata: { source: 'regex', confidence: 0.9, raw: 'CS' } }],
      residual: 'nonexistenttopic'
    };

    const plan: SearchPlan = {
      filters: { subject: 'CS' },
      semanticQuery: 'nonexistenttopic',
      keywordQuery: 'nonexistenttopic'
    };

    vi.mocked(extractor.extractQuery).mockReturnValue(extraction);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(plan);
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    await pipeline.search(request(query));

    for (const call of vi.mocked(termRanking.hybridSearchWithTermRanking).mock.calls) {
      expect(call[3].plan.filters.subject).toBe('CS');
    }
  });
});
