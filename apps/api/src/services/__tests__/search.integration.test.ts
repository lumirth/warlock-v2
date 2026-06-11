import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const COURSE_ID = "CS-225-2026-spring";
const testEnv = env as { DB: D1Database };

describe("Worker API integration", () => {
  beforeAll(seedSearchFixture);

  it("serves exact course lookup with a truthful total", async () => {
    const response = await SELF.fetch("http://local.test/api/search?q=CS%20225");

    expect(response.status).toBe(200);
    const data = await response.json() as {
      results: Array<{ course: { subject: string; number: string; title: string } }>;
      pagination: { totalResults: number };
    };
    expect(data.results[0]).toMatchObject({
      course: {
        subject: "CS",
        number: "225",
        title: "Data Structures",
      },
    });
    expect(data.pagination.totalResults).toBe(1);
  });

  it("executes natural-language FTS and candidate counting against local D1", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/search?q=Data%20Structures&scope=all",
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      results: Array<{ course: { id: string } }>;
      pagination: { totalResults: number };
    };
    expect(data.results[0]?.course.id).toBe(COURSE_ID);
    expect(data.pagination.totalResults).toBe(1);
  });

  it("executes filter-only requirement search against local D1", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/search?requirement=QR&scope=all",
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      results: Array<{ course: { id: string } }>;
      pagination: { totalResults: number };
    };
    expect(data.results[0]?.course.id).toBe(COURSE_ID);
    expect(data.pagination.totalResults).toBe(1);
  });

  it("preserves public search validation", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/search?q=CS&limit=999999",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "limit must be between 1 and 50",
    });
  });

  it("serves cached course detail through local D1", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/course/CS/225?term=spring&year=2026",
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      course: {
        id: string;
        subject: string;
        number: string;
        metrics: {
          avgGpa: number | null;
          gpaSampleSize: number | null;
          primaryInstructorRating: number | null;
          qualityScore: number | null;
          workloadScore: number | null;
        };
        sections?: Array<{
          crn: string;
          availability: { status: string; label: string };
        }>;
      };
      cache?: {
        cached?: boolean;
        termStatus?: string;
      };
    };

    expect(data).toMatchObject({
      course: {
        id: COURSE_ID,
        subject: "CS",
        number: "225",
        metrics: {
          avgGpa: 3.4,
          gpaSampleSize: 100,
          primaryInstructorRating: null,
          qualityScore: 88,
          workloadScore: 42,
        },
      },
      cache: {
        cached: true,
        termStatus: "active",
      },
    });
    expect(data.course.sections?.[0]).toMatchObject({
      crn: "12345",
      availability: { status: "open", label: "Open" },
    });
  });
});

async function seedSearchFixture(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await testEnv.DB.batch([
    testEnv.DB.prepare(`
      INSERT INTO subjects (id, name, last_synced)
      VALUES ('CS', 'Computer Science', ?)
    `).bind(now),
    testEnv.DB.prepare(`
      INSERT INTO term_state (
        term_id, year, term, status, last_checked, last_synced,
        subjects_count, courses_count, sections_count
      )
      VALUES ('2026-spring', 2026, 'spring', 'active', ?, ?, 1, 1, 1)
    `).bind(now, now),
    testEnv.DB.prepare(`
      INSERT INTO courses (
        id, subject, number, title, description, credit_hours, subject_id,
        year, term, avg_gpa, gpa_sample_size, primary_instructor,
        difficulty_score, quality_score, last_synced
      )
      VALUES (?, 'CS', '225', 'Data Structures', 'Data abstractions and algorithms.',
        4, 'CS', 2026, 'spring', 3.4, 100, 'Ada Lovelace', 42, 88, ?)
    `).bind(COURSE_ID, now),
    testEnv.DB.prepare(`
      INSERT INTO sections (
        id, crn, course_id, term_id, section_number, status, type, days,
        start_time, end_time, location, instructor, last_synced, part_of_term,
        credit_hours
      )
      VALUES ('2026-spring-12345', '12345', ?, '2026-spring', 'A', 'Open',
        'Lecture', 'MWF', '09:00', '09:50', 'Siebel 1404', 'Ada Lovelace', ?, '1', '4')
    `).bind(COURSE_ID, now),
    testEnv.DB.prepare(`
      INSERT INTO course_gened (
        course_id, category_id, category_name, attribute_code, attribute_name
      )
      VALUES (?, 'QR', 'Quantitative Reasoning', 'QR1', 'Quantitative Reasoning I')
    `).bind(COURSE_ID),
  ]);
}
