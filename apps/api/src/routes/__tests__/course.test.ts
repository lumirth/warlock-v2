import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { courseRoutes } from '../course.js';
import { browserFetch } from '../../http/browser-fetch.js';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

function app() {
  const hono = new Hono();
  hono.route('/', courseRoutes);
  return hono;
}

describe('course routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed subject and course number params', async () => {
    const res = await app().request('/api/course/too-long/not-a-number', {}, {
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'subject must be a 2-4 letter subject code' });
  });

  it('requires year and term query params to be provided together', async () => {
    const res = await app().request('/api/course/CS/225?year=2026', {}, {
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'year and term must be provided together' });
  });

  it('preserves stored score and GPA metadata on fresh course responses', async () => {
    const xml = `
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
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response(xml, { status: 200 }));

    const env = {
      DB: fakeDb(),
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
      CISAPI_BASE: 'https://courses.example.test',
      CLIENT_CACHE_TTL_MS: '0',
      BACKOFF_BASE_MS: '1',
      BACKOFF_MAX_MS: '1',
      MAX_RETRIES: '1',
    };

    const res = await app().request('/api/course/CS/225?term=spring&year=2026&fresh=true', {}, env);
    const data = await res.json() as {
      sections: Array<{
        crn: string;
        instructor: string;
        instructorRmp: number | null;
        instructorGpa: number | null;
        course_explorer_url: string;
        meetings: Array<{
          typeCode: string | null;
          buildingName: string | null;
          roomNumber: string | null;
          instructorNames: string[];
        }>;
      }>;
    } & Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      id: 'CS-225-2026-spring',
      avg_gpa: 3.62,
      gpa_sample_size: 820,
      primary_instructor_rmp: 4.8,
      quality_score: 88,
      difficulty_score: 42,
      _cached: false,
      _term_status: 'active',
    });
    expect(data.sections[0]).toMatchObject({
      crn: '12345',
      instructor: 'Lovelace, A',
      instructorRmp: 4.8,
      instructorGpa: 3.62,
      course_explorer_url: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
    });
    expect(data.sections[0].meetings[0]).toMatchObject({
      typeCode: 'LEC',
      buildingName: 'Siebel Center',
      roomNumber: '1404',
      instructorNames: ['Lovelace, A'],
    });
  });

  it('returns stale cached course data instead of 404 on first upstream rate limit', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response('', { status: 429 }));

    const env = {
      DB: fakeDb({ existingCourse: true }),
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
      CISAPI_BASE: 'https://courses.example.test',
      CLIENT_CACHE_TTL_MS: '0',
      BACKOFF_BASE_MS: '1',
      BACKOFF_MAX_MS: '1',
      MAX_RETRIES: '1',
    };

    const res = await app().request('/api/course/CS/225?term=spring&year=2026&fresh=true', {}, env);
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Cache')).toBe('STALE');
    expect(data).toMatchObject({
      id: 'CS-225-2026-spring',
      _stale: true,
      _stale_reason: 'upstream returned 429',
    });
  });
});

function fakeDb(options: { existingCourse?: boolean } = {}) {
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
            return options.existingCourse
              ? {
                id: 'CS-225-2026-spring',
                subject: 'CS',
                number: '225',
                title: 'Data Structures',
                description: 'Data abstractions and algorithms.',
                credit_hours: 4,
                gened: null,
                year: 2026,
                term: 'spring',
                avg_gpa: 3.62,
                gpa_sample_size: 820,
                primary_instructor: 'Lovelace, A',
                primary_instructor_rmp: 4.8,
                quality_score: 88,
                difficulty_score: 42,
                age_seconds: 999999,
              }
              : null;
          }

          if (sql.includes('SELECT rmp_rating, avg_gpa FROM instructors')) {
            return null;
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
                gpa_sample_size: 820,
              }],
            };
          }

          return { results: [] };
        },
      };
      return statement;
    },
  };
}
