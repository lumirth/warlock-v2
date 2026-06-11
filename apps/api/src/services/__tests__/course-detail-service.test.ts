import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserFetch } from '../../http/browser-fetch.js';
import { CourseDetailService, type CourseDetailServiceEnv } from '../course-detail-service.js';
import { getUpstreamBackoff, resetUpstreamBackoff } from '../upstream-backoff.js';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

describe('CourseDetailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUpstreamBackoff();
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
      },
    });
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
        stale: true,
      },
    });
  });

  it('returns a live detail with stored score and GPA metadata', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response(courseXml(), { status: 200 }));
    const service = new CourseDetailService(env());

    const result = await service.loadCourseDetail(request({ bypassCache: true }));

    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'X-Cache': 'MISS' });
    expect(result.body).toMatchObject({
      course: {
        id: 'CS-225-2026-spring',
        metrics: {
          avgGpa: 3.62,
          gpaSampleSize: 820,
          primaryInstructorRating: 4.8,
          qualityScore: 88,
          workloadScore: 42,
        },
        sections: [{
          crn: '12345',
          instructors: [expect.objectContaining({
            name: 'Lovelace, A',
            rmpRating: 4.8,
            avgGpa: 3.62,
          })],
          schedule: {
            meetings: [{
              typeCode: 'LEC',
              buildingName: 'Siebel Center',
              roomNumber: '1404',
              instructors: [expect.objectContaining({ name: 'Lovelace, A' })],
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

function env(options: { existingCourse?: boolean; ageSeconds?: number } = {}): CourseDetailServiceEnv {
  return {
    DB: fakeDb(options),
    CURRENT_YEAR: '2026',
    CURRENT_TERM: 'spring',
    CISAPI_BASE: 'https://courses.example.test',
    CLIENT_CACHE_TTL_MS: '30000',
    BACKOFF_BASE_MS: '1',
    BACKOFF_MAX_MS: '1',
    MAX_RETRIES: '1',
  } as CourseDetailServiceEnv;
}

function fakeDb(options: { existingCourse?: boolean; ageSeconds?: number } = {}) {
  const existingCourse = options.existingCourse ?? false;
  const ageSeconds = options.ageSeconds ?? 999999;

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
                instructor_name: 'Lovelace, A',
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
                instructor: 'Lovelace, A',
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
                instructor_names: 'Lovelace, A',
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

function storedCourse(ageSeconds: number) {
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
    primary_instructor: 'Lovelace, A',
    primary_instructor_rmp: 4.8,
    quality_score: 88,
    difficulty_score: 42,
    course_info: null,
    degree_attributes: null,
    class_schedule_info: null,
    date_range_text: null,
    registration_notes: null,
    approval_code: null,
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
