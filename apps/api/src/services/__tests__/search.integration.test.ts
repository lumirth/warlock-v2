import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  Ai,
  D1Database,
  D1PreparedStatement,
  Fetcher,
  KVNamespace,
  RateLimit,
  VectorizeIndex,
} from '@cloudflare/workers-types';
import worker from '../../index.js';
import { SearchPipeline } from '../search-pipeline.js';
import type { Course, Section } from '../../db/index.js';
import type { SearchResult } from '../search.js';

vi.mock('../search-pipeline.js', () => ({
  SearchPipeline: vi.fn(),
}));

type D1Row = Record<string, unknown>;

type TestBindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SELF: Fetcher;
  GPA_CACHE: KVNamespace;
  SEARCH_RATE_LIMITER: RateLimit;
  COURSE_RATE_LIMITER: RateLimit;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;
  SYNC_CONCURRENCY: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
  ADMIN_TOKEN: string;
  INTERNAL_TOKEN: string;
};

const courseRow: Course & { age_seconds: number } = {
  id: 'CS-225-2026-spring',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data abstractions and algorithms.',
  credit_hours: 4,
  gened: null,
  year: 2026,
  term: 'spring',
  avg_gpa: 3.4,
  gpa_sample_size: 100,
  primary_instructor: 'Ada Lovelace',
  primary_instructor_rmp: null,
  difficulty_score: 42,
  quality_score: 88,
  subject_id: 'CS',
  course_info: null,
  degree_attributes: null,
  class_schedule_info: null,
  date_range_text: null,
  registration_notes: null,
  approval_code: null,
  last_synced: Math.floor(Date.now() / 1000),
  created_at: Math.floor(Date.now() / 1000),
  updated_at: Math.floor(Date.now() / 1000),
  age_seconds: 10,
};

const sectionRow: Section = {
  id: '2026-spring-12345',
  crn: '12345',
  course_id: courseRow.id,
  term_id: '2026-spring',
  section_number: 'A',
  status: 'Open',
  type: 'Lecture',
  days: 'MWF',
  start_time: '09:00',
  end_time: '09:50',
  location: 'Siebel 1404',
  instructor: 'Ada Lovelace',
  instructor_rmp: null,
  instructor_gpa: null,
  last_synced: courseRow.last_synced,
  section_title: null,
  status_code: null,
  section_status_code: null,
  section_text: null,
  section_notes: null,
  capp_area: null,
  date_range_text: null,
  part_of_term: '1',
  start_date: null,
  end_date: null,
  credit_hours: '4',
};

class TestD1Statement {
  private params: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = D1Row>(): Promise<T | null> {
    if (this.sql.includes('FROM term_state')) {
      return {
        term_id: '2026-spring',
        year: 2026,
        term: 'spring',
        status: 'active',
      } as T;
    }

    if (this.sql.includes('FROM courses WHERE id = ?') && this.params[0] === courseRow.id) {
      return courseRow as T;
    }

    return null;
  }

  async all<T = D1Row>(): Promise<D1Result<T>> {
    let results: D1Row[] = [];

    if (this.sql.includes('FROM term_state')) {
      results = [
        { term_id: '2026-spring', status: 'active' },
      ];
    } else if (this.sql.includes('FROM sections WHERE course_id = ?') && this.params[0] === courseRow.id) {
      results = [sectionRow as unknown as D1Row];
    } else if (this.sql.includes('FROM instructor_course_links')) {
      results = [];
    }

    return {
      results: results as T[],
      success: true,
      meta: {},
    } as unknown as D1Result<T>;
  }
}

function createDb(): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return new TestD1Statement(sql) as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function createRateLimit(success = true): RateLimit {
  return {
    limit: vi.fn(async () => ({ success })),
  } as unknown as RateLimit;
}

function createEnv(overrides: Partial<TestBindings> = {}): TestBindings {
  return {
    DB: createDb(),
    VECTORIZE: {} as unknown as VectorizeIndex,
    AI: {} as unknown as Ai,
    SELF: {} as unknown as Fetcher,
    GPA_CACHE: {} as unknown as KVNamespace,
    SEARCH_RATE_LIMITER: createRateLimit(),
    COURSE_RATE_LIMITER: createRateLimit(),
    CURRENT_YEAR: '2026',
    CURRENT_TERM: 'spring',
    CISAPI_BASE: 'https://courses.illinois.edu/cisapp/explorer/catalog',
    FRONTEND_BASE: 'http://localhost:5173',
    SYNC_CONCURRENCY: '1',
    BACKOFF_BASE_MS: '1000',
    BACKOFF_MAX_MS: '1000',
    MAX_RETRIES: '1',
    CLIENT_CACHE_TTL_MS: '300000',
    ADMIN_TOKEN: 'admin-token',
    INTERNAL_TOKEN: 'internal-token',
    ...overrides,
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function mockSearchResult(): SearchResult {
  return {
    course: courseRow,
    score: 1,
    semanticRank: undefined,
    keywordRank: 1,
    termPriority: 0,
    historical: false,
  };
}

describe('Worker API integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: vi.fn().mockResolvedValue({
          results: [mockSearchResult()],
          meta: {
            query: { raw: 'CS 225', residual: '' },
            extraction: { hints: [] },
            plan: { filters: { subject: 'CS', number: '225' }, semanticQuery: '', keywordQuery: '' },
            timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
          },
        }),
      } as unknown as SearchPipeline;
    });
  });

  it('serves search through the Worker fetch handler without a live server', async () => {
    const response = await worker.fetch(
      new Request('http://local.test/api/search?q=CS%20225'),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { results: Array<{ subject: string; number: string; title: string }> };
    expect(data.results[0]).toMatchObject({
      subject: 'CS',
      number: '225',
      title: 'Data Structures',
    });
  });

  it('preserves public search validation through the Worker fetch handler', async () => {
    const response = await worker.fetch(
      new Request('http://local.test/api/search?q=CS&limit=999999'),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'limit must be between 1 and 50' });
  });

  it('rate limits public search before running the pipeline', async () => {
    const response = await worker.fetch(
      new Request('http://local.test/api/search?q=CS%20225', {
        headers: { 'cf-connecting-ip': '198.51.100.10' },
      }),
      createEnv({ SEARCH_RATE_LIMITER: createRateLimit(false) }),
      createExecutionContext(),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate limit exceeded' });
    expect(SearchPipeline).not.toHaveBeenCalled();
  });

  it('rate limits public course detail requests', async () => {
    const response = await worker.fetch(
      new Request('http://local.test/api/course/CS/225', {
        headers: { 'cf-connecting-ip': '198.51.100.11' },
      }),
      createEnv({ COURSE_RATE_LIMITER: createRateLimit(false) }),
      createExecutionContext(),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate limit exceeded' });
  });

  it('serves cached course detail through the Worker fetch handler', async () => {
    const response = await worker.fetch(
      new Request('http://local.test/api/course/CS/225?term=spring&year=2026'),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      id: string;
      subject: string;
      number: string;
      avg_gpa: number | null;
      gpa_sample_size: number | null;
      primary_instructor_rmp: number | null;
      quality_score: number | null;
      difficulty_score: number | null;
      sections?: Array<{ crn: string; status: string }>;
      _cached?: boolean;
      _term_status?: string;
    };

    expect(data).toMatchObject({
      id: courseRow.id,
      subject: 'CS',
      number: '225',
      avg_gpa: 3.4,
      gpa_sample_size: 100,
      primary_instructor_rmp: null,
      quality_score: 88,
      difficulty_score: 42,
      _cached: true,
      _term_status: 'active',
    });
    expect(data.sections?.[0]).toMatchObject({ crn: '12345', status: 'Open' });
  });
});
