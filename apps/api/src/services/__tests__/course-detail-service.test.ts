import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import { browserFetch } from '../../http/browser-fetch.js';
import { CourseDetailService, type CourseDetailServiceEnv } from '../course-detail-service.js';
import { resetCourseDetailInFlightRequests } from '../course-detail-live-source.js';
import { getUpstreamBackoff, resetUpstreamBackoff } from '../upstream-backoff.js';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

describe('CourseDetailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUpstreamBackoff();
    resetCourseDetailInFlightRequests();
  });

  it('returns a fresh cached detail without calling upstream', async () => {
    const service = new CourseDetailService(env({ existingCourse: true, ageSeconds: 2 }));

    const result = await service.loadCourseDetail(request());

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'X-Cache': 'HIT' });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      course: {
        id: 'CS-225-2026-spring',
        sections: [{
          crn: '12345',
          schedule: {
            partOfTerm: 'A',
            meetings: [{
              typeCode: 'LEC',
              buildingName: 'Siebel Center',
            }],
          },
        }],
      },
      cache: {
        cached: true,
        ageSeconds: 2,
        fetchedAt: 1_800_000_000,
      },
    });
  });

  it.each([
    ['unknown', null],
    ['negative', -1],
    ['non-finite', Number.POSITIVE_INFINITY],
  ] as const)('does not treat a %s stored age as fresh', async (_label, ageSeconds) => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response(courseXml(), { status: 200 }));
    const service = new CourseDetailService(env({ existingCourse: true, ageSeconds }));

    const result = await service.loadCourseDetail(request());

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'X-Cache': 'MISS' });
    expect(browserFetch).toHaveBeenCalledTimes(1);
  });

  it('returns stale fallback while upstream backoff is active', async () => {
    getUpstreamBackoff({ backoffBaseMs: 60000, backoffMaxMs: 60000, maxRetries: 1 })
      .recordFailure('CS 225: 429', 429);
    const service = new CourseDetailService(env({ existingCourse: true }), () => Date.now());

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({
      'X-Cache': 'STALE',
      'X-Stale-Reason': 'rate-limited',
    });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      course: {
        id: 'CS-225-2026-spring',
      },
      cache: {
        cached: true,
        stale: true,
        fetchedAt: 1_800_000_000,
      },
    });
  });

  it('returns a live detail with stored score and GPA metadata', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response(courseXml(), { status: 200 }));
    const service = new CourseDetailService(env());

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'X-Cache': 'MISS' });
    expect(result.headers?.['Cache-Control']).toContain('s-maxage=300');
    expect(browserFetch).toHaveBeenCalledWith(
      expect.stringContaining('/schedule/2026/spring/CS/225.xml'),
      expect.objectContaining({
        retries: 1,
        timeoutMs: 10_000,
        signal: expect.any(Object),
      }),
    );
    expect(result.body).toMatchObject({
      course: {
        id: 'CS-225-2026-spring',
        metrics: {
          avgGpa: 3.62,
          gpaSampleSize: 820,
          primaryInstructorRating: 4.8,
          qualityScore: 88,
          instructorDifficultyScore: 42,
        },
        sections: [{
          crn: '12345',
          instructors: [expect.objectContaining({
            name: 'Lovelace, Ada',
            rmpRating: 4.8,
            avgGpa: 3.62,
          })],
          schedule: {
            meetings: [{
              typeCode: 'LEC',
              buildingName: 'Siebel Center',
              roomNumber: '1404',
              instructors: [expect.objectContaining({ name: 'Lovelace, Ada' })],
            }],
          },
        }],
      },
      cache: {
        cached: false,
        termStatus: 'active',
      },
    });
  });

  it('reuses a verified live snapshot instead of refetching after 30 seconds', async () => {
    vi.mocked(browserFetch).mockResolvedValue(new Response(courseXml(), { status: 200 }));
    const searchCache = memoryKv();
    const sharedEnv = env({ searchCache });
    const firstNow = 1_800_000_000_000;

    const first = await new CourseDetailService(sharedEnv, () => firstNow)
      .loadCourseDetail(request());
    const second = await new CourseDetailService(
      sharedEnv,
      () => firstNow + 31_000,
    )
      .loadCourseDetail(request());

    expect(first.headers).toMatchObject({ 'X-Cache': 'MISS' });
    expect(second.headers).toMatchObject({ 'X-Cache': 'LIVE-HIT' });
    expect(second.body).toMatchObject({
      cache: {
        cached: true,
        fetchedAt: expect.any(Number),
      },
    });
    expect(browserFetch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent live fetches inside a Worker isolate', async () => {
    vi.mocked(browserFetch).mockResolvedValue(new Response(courseXml(), { status: 200 }));
    const sharedEnv = env();

    const [first, second] = await Promise.all([
      new CourseDetailService(sharedEnv).loadCourseDetail(request()),
      new CourseDetailService(sharedEnv).loadCourseDetail(request()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(browserFetch).toHaveBeenCalledTimes(1);
  });

  it('treats a successful HTML challenge as upstream failure and serves stale data', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(
      new Response('<HTML><title>Challenge</title></HTML>', { status: 200 }),
    );
    const service = new CourseDetailService(env({ existingCourse: true }));

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({
      'X-Cache': 'STALE',
      'X-Stale-Reason': 'upstream-unavailable',
    });
    expect(result.body).toMatchObject({
      cache: {
        stale: true,
        staleReason: 'upstream returned 200',
      },
    });
  });

  it('bounds a response body that never finishes and serves stale data', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(browserFetch).mockResolvedValueOnce(new Response(
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200 },
      ));
      const service = new CourseDetailService(env({ existingCourse: true }));

      const resultPromise = service.loadCourseDetail(request({ bypassCache: true }));
      await vi.advanceTimersByTimeAsync(10_001);
      const result = await resultPromise;

      expect(result.status).toBe(200);
      expect(result.headers).toMatchObject({
        'X-Cache': 'STALE',
        'X-Stale-Reason': 'upstream-unavailable',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a mismatched upstream course identity and serves stale data', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(
      new Response(courseXml().replace('id="CS 225"', 'id="CS 226"'), { status: 200 }),
    );
    const service = new CourseDetailService(env({ existingCourse: true }));

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({
      'X-Cache': 'STALE',
      'X-Stale-Reason': 'upstream-unavailable',
    });
    expect(result.body).toMatchObject({
      cache: {
        cached: true,
        stale: true,
        staleReason: 'upstream returned 502',
      },
    });
  });

  it('returns stale fallback when live upstream fetch fails', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response('', { status: 503 }));
    const service = new CourseDetailService(env({ existingCourse: true }));

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({
      'X-Cache': 'STALE',
      'X-Stale-Reason': 'upstream-unavailable',
    });
    expect(result.body).toMatchObject({
      course: {
        id: 'CS-225-2026-spring',
      },
      cache: {
        stale: true,
        staleReason: 'upstream returned 503',
      },
    });
  });

  it('returns a no-data failure when upstream fails and no stale course exists', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response('', { status: 429 }));
    const service = new CourseDetailService(env({ existingCourse: false }));

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      error: 'Upstream course data unavailable',
      upstreamStatus: 429,
    });
  });
});

function request(overrides: Partial<{ bypassCache: boolean }> = {}) {
  return {
    subject: 'CS',
    number: '225',
    requestedYear: '2026',
    requestedTerm: 'spring',
    bypassCache: overrides.bypassCache ?? false,
  };
}

function env(options: {
  existingCourse?: boolean;
  ageSeconds?: number | null;
  searchCache?: KVNamespace;
} = {}): CourseDetailServiceEnv {
  return {
    DB: fakeDb(options),
    CURRENT_YEAR: '2026',
    CURRENT_TERM: 'spring',
    CISAPI_BASE: 'https://courses.example.test',
    CLIENT_CACHE_TTL_MS: '30000',
    BACKOFF_BASE_MS: '1',
    BACKOFF_MAX_MS: '1',
    MAX_RETRIES: '1',
    SEARCH_CACHE: options.searchCache,
  } as CourseDetailServiceEnv;
}

function memoryKv(): KVNamespace {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  } as unknown as KVNamespace;
}

function fakeDb(options: { existingCourse?: boolean; ageSeconds?: number | null } = {}) {
  const existingCourse = options.existingCourse ?? false;
  const ageSeconds = options.ageSeconds === undefined ? 999999 : options.ageSeconds;

  return {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async first() {
          if (sql.includes('FROM term_state')) {
            return {
              term_id: '2026-spring',
              year: 2026,
              term: 'spring',
              status: 'active',
            };
          }

          if (sql.includes('SELECT *, (unixepoch() - last_synced) as age_seconds FROM courses')) {
            return existingCourse ? storedCourse(ageSeconds) : null;
          }

          if (sql.includes('SELECT avg_gpa, gpa_sample_size, primary_instructor_rmp')) {
            return {
              avg_gpa: 3.62,
              gpa_sample_size: 820,
              primary_instructor_rmp: 4.8,
              quality_score: 88,
              difficulty_score: 42,
            };
          }

          if (sql.includes('WHERE subject = ? AND number = ? AND instructor IS NULL')) {
            return { median_gpa: 3.55 };
          }

          if (sql.includes('SELECT AVG(median_gpa) as median_gpa')) {
            return { median_gpa: 3.55 };
          }

          return null;
        },
        async all() {
          if (sql.includes('FROM instructor_course_links')) {
            return {
              results: [{
                instructor_name: 'Lovelace, Ada',
                rmp_rating: 4.8,
                rmp_difficulty: 3.1,
                rmp_id: 'ada',
                avg_gpa: 3.62,
                median_gpa: 3.55,
                gpa_sample_size: 820,
              }],
            };
          }

          if (sql.includes('SELECT * FROM sections WHERE course_id = ?')) {
            return {
              results: [{
                id: 'section-1',
                crn: '12345',
                course_id: 'CS-225-2026-spring',
                term_id: '2026-spring',
                section_number: 'AL1',
                status: 'Open',
                type: 'Lecture',
                days: 'MWF',
                start_time: '09:00',
                end_time: '09:50',
                location: 'Siebel Center 1404',
                instructor: 'Lovelace, Ada',
                instructor_rmp: null,
                instructor_gpa: null,
                last_synced: null,
                section_title: null,
                status_code: null,
                section_status_code: null,
                section_text: null,
                section_notes: null,
                capp_area: null,
                date_range_text: '03/16/2026 - 05/06/2026',
                part_of_term: 'A',
                start_date: '2026-03-16',
                end_date: '2026-05-06',
                credit_hours: '4',
              }],
            };
          }

          if (sql.includes('FROM meetings m')) {
            return {
              results: [{
                id: 1,
                section_id: 'section-1',
                meeting_index: 0,
                type_code: 'LEC',
                type_name: 'Lecture',
                days: 'MWF',
                start_time: '09:00',
                end_time: '09:50',
                building_name: 'Siebel Center',
                room_number: '1404',
                date_range_text: '03/16/2026 - 05/06/2026',
                instructor_names: 'Lovelace, Ada',
              }],
            };
          }

          if (sql.includes('FROM course_gened')) {
            return {
              results: [{
                category_id: 'QR',
                category_name: 'Quantitative Reasoning',
                attribute_code: '',
                attribute_name: null,
              }],
            };
          }

          return { results: [] };
        },
      };
      return statement;
    },
  } as unknown as CourseDetailServiceEnv['DB'];
}

function storedCourse(ageSeconds: number | null) {
  return {
    id: 'CS-225-2026-spring',
    subject: 'CS',
    number: '225',
    title: 'Data Structures',
    description: 'Data abstractions and algorithms.',
    credit_hours: 4,
    year: 2026,
    term: 'spring',
    avg_gpa: 3.62,
    gpa_sample_size: 820,
    primary_instructor: 'Lovelace, Ada',
    primary_instructor_rmp: 4.8,
    quality_score: 88,
    difficulty_score: 42,
    course_info: null,
    degree_attributes: null,
    class_schedule_info: null,
    date_range_text: null,
    registration_notes: null,
    approval_code: null,
    last_synced: 1_800_000_000,
    created_at: 1_800_000_000,
    updated_at: 1_800_000_000,
    age_seconds: ageSeconds,
  };
}

function courseXml() {
  return `
    <course id="CS 225">
      <subject id="CS">Computer Science</subject>
      <label>Data Structures</label>
      <description>Data abstractions and algorithms.</description>
      <creditHours>4 hours.</creditHours>
      <detailedSection id="12345">
        <sectionNumber>AL1</sectionNumber>
        <enrollmentStatus>Open</enrollmentStatus>
        <meeting>
          <type code="LEC">Lecture</type>
          <start>09:00 AM</start>
          <end>09:50 AM</end>
          <daysOfTheWeek>MWF</daysOfTheWeek>
          <buildingName>Siebel Center</buildingName>
          <roomNumber>1404</roomNumber>
          <instructor firstName="Ada" lastName="Lovelace"></instructor>
        </meeting>
      </detailedSection>
    </course>
  `;
}
