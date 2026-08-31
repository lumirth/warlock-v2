import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { executeSearch } from "../search-engine.js";
import type { SearchPlan } from "../search-planner-types.js";

const COURSE_ID = "CS-225-2026-spring";
const testEnv = env as { DB: D1Database };

describe("Worker API integration", () => {
  beforeAll(seedSearchFixture);

  it("reports only a fully published catalog as ready", async () => {
    await testEnv.DB.prepare(`
      INSERT INTO term_state (term_id, year, term, status, last_checked)
      VALUES ('2099-fall', 2099, 'fall', 'active', unixepoch())
    `).run();
    const response = await SELF.fetch("http://local.test/");
    const data = await response.json() as { term: string | null };
    expect(response.status).toBe(200);
    expect(data.term).toBe("spring 2026");
    await testEnv.DB.prepare("DELETE FROM term_state WHERE term_id = '2099-fall'").run();
  });

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
    expect(data).not.toHaveProperty("meta.plan");
    expect(data).not.toHaveProperty("meta.extraction");
    expect(data).not.toHaveProperty("meta.retrievalPlan");
  });

  it("executes natural-language FTS and candidate counting against local D1", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/search?q=Data%20Structures&scope=all",
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      results: Array<{
        course: {
          id: string;
          registrationSummary?: {
            total: number;
            open: number;
            restricted: number;
            waitlisted: number;
            closed: number;
            cancelled: number;
            lastSynced: number | null;
          };
        };
      }>;
      pagination: { totalResults: number };
    };
    expect(data.results[0]?.course.id).toBe(COURSE_ID);
    expect(data.pagination.totalResults).toBe(1);
    expect(data.results[0]?.course.registrationSummary).toEqual({
      total: 1,
      open: 1,
      restricted: 0,
      waitlisted: 0,
      closed: 0,
      cancelled: 0,
      lastSynced: expect.any(Number),
    });
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

  it("publishes one canonical chip for explicit term and year filters", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/search?subject=CS&term=spring&year=2026&scope=all",
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      meta: { ui: { chips: Array<{
        type: string;
        label: string;
        removeRequest: { filters?: { subject?: string; term?: string; year?: number } };
      }> } };
    };
    const termChips = data.meta.ui.chips.filter(chip => chip.type === "term" || chip.type === "year");
    expect(termChips).toHaveLength(1);
    expect(termChips[0]).toMatchObject({
      type: "term",
      label: "Term: spring 2026",
      removeRequest: { filters: { subject: "CS" } },
    });
  });

  it("applies workload exclusions to prerequisite and degree text", async () => {
    const response = await SELF.fetch("http://local.test/api/search?q=no%20exams%20CS&scope=all");
    expect(response.status).toBe(200);
    const data = await response.json() as { results: unknown[] };
    expect(data.results).toEqual([]);
  });

  it("retrieves deterministic topic expansions through D1 full-text search", async () => {
    const result = await executeSearch(
      testEnv.DB,
      {
        ...plan({ subject: "CS" }, "unmatched phrase"),
        softPreferences: { topicExpansions: ["data structures"] },
      },
      { scope: "all", sort: { field: "relevance", direction: "desc" } },
    );

    expect(result.totalResults).toBe(1);
    expect(result.results[0]?.course.id).toBe(COURSE_ID);
    expect(result.failedLanes).toEqual([]);
  });

  it("keeps long exact-title FTS recall within D1's LIKE-pattern limit", async () => {
    const title = "Distributed Systems Reliability Engineering Laboratory Practicum";
    const id = "LONG-999-2026-spring";
    expect(new TextEncoder().encode(`%${title.toLowerCase()}%`).byteLength).toBeGreaterThan(50);
    await testEnv.DB.prepare(`
      INSERT INTO courses (id, subject, number, title, year, term)
      VALUES (?, 'LONG', '999', ?, 2026, 'spring')
    `).bind(id, title).run();

    const result = await executeSearch(
      testEnv.DB,
      plan({ subject: "LONG" }, title.toLowerCase()),
      { scope: "all", sort: { field: "relevance", direction: "desc" } },
    );

    expect(result.totalResults).toBe(1);
    expect(result.results[0]?.course.id).toBe(id);
    expect(result.failedLanes).toEqual([]);
  });

  it("keeps long instructor filters within D1's LIKE-pattern limit", async () => {
    const instructor = "x".repeat(60);
    expect(new TextEncoder().encode(`%${instructor}%`).byteLength).toBeGreaterThan(50);

    const response = await SELF.fetch(
      `http://local.test/api/search?instructor=${instructor}&scope=all`,
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { results: unknown[]; pagination: { totalResults: number } };
    expect(data.results).toEqual([]);
    expect(data.pagination.totalResults).toBe(0);
  });

  it("sorts structured results in D1 before applying the result limit", async () => {
    const response = await SELF.fetch(
      "http://local.test/api/search?subject=MATH&sort=gpa&direction=desc&limit=1&scope=all",
    );

    expect(response.status).toBe(200);
    const data = await response.json() as {
      results: Array<{ course: { id: string } }>;
      pagination: { totalResults: number };
    };
    expect(data.results.map(({ course }) => course.id))
      .toEqual(["MATH-102-2026-spring"]);
    expect(data.pagination.totalResults).toBe(2);
  });

  it("applies section-code precedence when registration codes conflict", async () => {
    const openResponse = await SELF.fetch(
      "http://local.test/api/search?subject=MATH&status=open&year=2026&term=spring&scope=all",
    );
    const closedResponse = await SELF.fetch(
      "http://local.test/api/search?subject=MATH&status=closed&year=2026&term=spring&scope=all",
    );

    expect(openResponse.status).toBe(200);
    expect(closedResponse.status).toBe(200);
    const openData = await openResponse.json() as {
      results: Array<{ course: { id: string } }>;
    };
    const closedData = await closedResponse.json() as {
      results: Array<{ course: { id: string } }>;
    };
    expect(openData.results.map(({ course }) => course.id))
      .toEqual(["MATH-102-2026-spring"]);
    expect(closedData.results.map(({ course }) => course.id))
      .toEqual(["MATH-101-2026-spring"]);
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

  it("restricts feedback writes to the configured frontend origin", async () => {
    const payload = JSON.stringify({
      page: "search",
      query: "data structures",
      expected: "More relevant data structures results",
    });
    const blocked = await SELF.fetch("http://local.test/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(blocked.status).toBe(403);

    const accepted = await SELF.fetch("http://local.test/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://local.test",
      },
      body: payload,
    });
    expect(accepted.status).toBe(202);
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
          instructorDifficultyScore: number | null;
        };
        sections?: Array<{
          crn: string;
          availability: { status: string; label: string };
        }>;
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
          instructorDifficultyScore: 42,
        },
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
      INSERT INTO subjects (id, name)
      VALUES ('CS', 'Computer Science')
    `),
    testEnv.DB.prepare(`
      INSERT INTO subjects (id, name)
      VALUES ('MATH', 'Mathematics')
    `),
    testEnv.DB.prepare(`
      INSERT INTO term_state (
        term_id, year, term, status, last_checked, last_synced,
        subjects_count, courses_count, sections_count
      )
      VALUES ('2026-spring', 2026, 'spring', 'active', ?, ?, 1, 1, 1)
    `).bind(now, now),
    testEnv.DB.prepare(`
      INSERT INTO courses (
        id, subject, number, title, description, credit_hours, subject_id, course_info,
        year, term, avg_gpa, gpa_sample_size, primary_instructor,
        difficulty_score, quality_score
      )
      VALUES (?, 'CS', '225', 'Data Structures', 'Data abstractions and algorithms.',
        4, 'CS', 'Includes proctored exams.', 2026, 'spring', 3.4, 100,
        'Ada Lovelace', 42, 88)
    `).bind(COURSE_ID),
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
    testEnv.DB.prepare(`
      INSERT INTO courses (
        id, subject, number, title, description, credit_hours, subject_id,
        year, term, avg_gpa
      )
      VALUES
        ('MATH-101-2026-spring', 'MATH', '101', 'Closed by section code',
          'Conflicting registration codes.', 3, 'MATH', 2026, 'spring', 2.1),
        ('MATH-102-2026-spring', 'MATH', '102', 'Open by section code',
          'Conflicting registration codes.', 3, 'MATH', 2026, 'spring', 3.9)
    `),
    testEnv.DB.prepare(`
      INSERT INTO sections (
        id, crn, course_id, term_id, section_number, status,
        section_status_code, status_code, last_synced
      )
      VALUES
        ('2026-spring-22345', '22345', 'MATH-101-2026-spring', '2026-spring',
          'A', 'Unknown', 'C', 'A', ?),
        ('2026-spring-22346', '22346', 'MATH-102-2026-spring', '2026-spring',
          'A', 'Unknown', 'A', 'C', ?)
    `).bind(now, now),
  ]);
}

function plan(
  filters: SearchPlan["filters"],
  keywordQuery = "",
): SearchPlan {
  return { filters, keywordQuery };
}
