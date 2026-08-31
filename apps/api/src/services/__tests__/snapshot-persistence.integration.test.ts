import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectSnapshot } from "../../transforms/course.js";
import { writeSubjectSnapshotToD1 } from "../course-snapshot-writer.js";
import { syncSubjects } from "../parallel-sync.js";

const testEnv = env as { DB: D1Database };
const SYNC_TIME = 1_780_000_000;
const COURSE_ID = "TST-100-2026-spring";
const SECTION_ID = "2026-spring-98765";
const LATE_SECTION_ID = "2026-spring-99999";
const CASCADE_XML = `
  <subject id="TST"><label>Test Studies</label>
    <cascadingCourse id="TST 100"><label>Published test course</label><creditHours>3</creditHours>
      <detailedSection id="98765"><sectionNumber>A</sectionNumber><enrollmentStatus>Open</enrollmentStatus></detailedSection>
    </cascadingCourse>
  </subject>`;

describe("subject snapshot reconciliation", () => {
  beforeEach(async () => {
    await testEnv.DB.prepare("DROP TRIGGER IF EXISTS snapshot_test_abort").run();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "DELETE FROM subject_sync_state WHERE term_id = '2026-spring' AND subject = 'TST'",
      ),
      testEnv.DB.prepare("DELETE FROM courses WHERE subject = 'TST'"),
      testEnv.DB.prepare(
        "DELETE FROM instructors WHERE last_name IN ('Lovelace', 'Hopper')",
      ),
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testEnv.DB.prepare("DROP TRIGGER IF EXISTS snapshot_test_abort").run();
  });

  it("publishes the fetched subject snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(CASCADE_XML));

    const result = await syncSubjects(
      testEnv.DB,
      { cisapiBase: "https://courses.test" },
      2026,
      "spring",
      ["TST"],
    );

    expect(result).toMatchObject({ successfulSubjects: 1, failedSubjects: 0 });
    await expect(testEnv.DB.prepare(
      "SELECT title FROM courses WHERE id = ?",
    ).bind(COURSE_ID).first()).resolves.toEqual({
      title: "Published test course",
    });
    await expect(testEnv.DB.prepare(`
      SELECT status, courses_synced, owner_token
      FROM subject_sync_state WHERE term_id = '2026-spring' AND subject = 'TST'
    `).first()).resolves.toEqual({
      status: "complete",
      courses_synced: 1,
      owner_token: null,
    });
  });

  it("removes vanished meetings, instructor links, GenEds, and courses without relying on timestamp uniqueness", async () => {
    await writeSubjectSnapshotToD1(
      testEnv.DB,
      snapshot({
        meetings: [
          meeting(0, "Lovelace", "Ada"),
          meeting(1, "Lovelace", "Ada"),
        ],
        includeGenEd: true,
      }),
    );

    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO courses (
          id, subject, number, title, year, term, subject_id
        ) VALUES (
          'TST-200-2026-spring', 'TST', '200', 'Removed course',
          2026, 'spring', 'TST'
        )
      `),
      testEnv.DB.prepare(`
        INSERT INTO sections (
          id, crn, course_id, term_id, section_number, last_synced
        ) VALUES (
          '2026-spring-98766', '98766', 'TST-200-2026-spring',
          '2026-spring', 'A', ?
        )
      `).bind(SYNC_TIME),
    ]);

    await writeSubjectSnapshotToD1(
      testEnv.DB,
      snapshot({
        meetings: [meeting(0, "Hopper", "Grace")],
        includeGenEd: false,
      }),
    );

    const meetings = await testEnv.DB.prepare(`
      SELECT meeting_index
      FROM meetings
      WHERE section_id = ?
      ORDER BY meeting_index
    `).bind(SECTION_ID).all<{ meeting_index: number }>();
    expect(meetings.results).toEqual([{ meeting_index: 0 }]);

    const linkedInstructors = await testEnv.DB.prepare(`
      SELECT i.display_name
      FROM meeting_instructors mi
      JOIN meetings m ON m.id = mi.meeting_id
      JOIN instructors i ON i.id = mi.instructor_id
      WHERE m.section_id = ?
      ORDER BY i.display_name
    `).bind(SECTION_ID).all<{ display_name: string }>();
    expect(linkedInstructors.results).toEqual([
      { display_name: "Hopper, Grace" },
    ]);

    const genEds = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM course_gened WHERE course_id = ?",
    ).bind(COURSE_ID).first<{ count: number }>();
    expect(genEds?.count).toBe(0);

    const removedCourse = await testEnv.DB.prepare(
      "SELECT id FROM courses WHERE id = 'TST-200-2026-spring'",
    ).first();
    expect(removedCourse).toBeNull();
  });

  it("atomically rejects a stale owner's snapshot and accepts the current owner", async () => {
    await writeSubjectSnapshotToD1(
      testEnv.DB,
      snapshot({
        meetings: [meeting(0, "Lovelace", "Ada")],
        includeGenEd: false,
      }),
    );
    await testEnv.DB.prepare(`
      UPDATE courses SET title = 'Current published title', avg_gpa = 3.8,
        gpa_sample_size = 120, primary_instructor_rmp = 4.7,
        difficulty_score = 2.1, quality_score = 4.5 WHERE id = ?
    `).bind(COURSE_ID).run();
    await testEnv.DB.prepare(`
      INSERT INTO subject_sync_state (
        term_id, subject, last_sync, status, courses_synced, sections_synced,
        owner_token
      ) VALUES ('2026-spring', 'TST', unixepoch(), 'running', 0, 0, ?)
    `).bind("subject:current-owner").run();

    const staleSnapshot = snapshot({
      meetings: [meeting(0, "Hopper", "Grace")],
      includeGenEd: true,
    });
    staleSnapshot.courses[0].course.title = "Stale owner title";
    await expect(writeSubjectSnapshotToD1(testEnv.DB, staleSnapshot, {
      publicationFence: {
        termId: "2026-spring",
        subject: "TST",
        ownerToken: "subject:stale-owner",
      },
    })).rejects.toThrow();

    const afterStaleAttempt = await testEnv.DB.prepare(
      "SELECT title FROM courses WHERE id = ?",
    ).bind(COURSE_ID).first<{ title: string }>();
    expect(afterStaleAttempt?.title).toBe("Current published title");

    const currentSnapshot = snapshot({
      meetings: [meeting(0, "Hopper", "Grace")],
      includeGenEd: true,
    });
    currentSnapshot.courses[0].course.title = "Current owner title";
    await writeSubjectSnapshotToD1(testEnv.DB, currentSnapshot, {
      publicationFence: {
        termId: "2026-spring",
        subject: "TST",
        ownerToken: "subject:current-owner",
      },
    });

    const afterCurrentPublication = await testEnv.DB.prepare(`
      SELECT c.title, c.avg_gpa, c.gpa_sample_size, c.primary_instructor_rmp,
        c.difficulty_score, c.quality_score
      FROM courses c
      WHERE c.id = ?
    `).bind(COURSE_ID).first();
    const fenceRows = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM subject_sync_publication_fences",
    ).first<{ count: number }>();
    expect(afterCurrentPublication).toEqual({
      title: "Current owner title",
      avg_gpa: 3.8,
      gpa_sample_size: 120,
      primary_instructor_rmp: 4.7,
      difficulty_score: 2.1,
      quality_score: 4.5,
    });
    expect(fenceRows?.count).toBe(0);
  });

  it("rejects a valid snapshot when it does not match the leased subject", async () => {
    await expect(writeSubjectSnapshotToD1(testEnv.DB, snapshot({
      meetings: [meeting(0, "Lovelace", "Ada")],
      includeGenEd: false,
    }), {
      publicationFence: {
        termId: "2026-spring",
        subject: "MATH",
        ownerToken: "subject:wrong-scope",
      },
    })).rejects.toThrow("lease subject mismatch");
  });

  it("publishes more than 1,000 nested rows with a bounded query shape", async () => {
    let batches = 0;
    let statementCount = 0;
    const instrumentedDb = {
      prepare: (sql: string) => testEnv.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        batches += 1;
        statementCount = statements.length;
        return testEnv.DB.batch(statements);
      },
    } as unknown as D1Database;
    const largeSnapshot = snapshot({
      meetings: Array.from({ length: 1_001 }, (_, index) =>
        meeting(index, "Lovelace", "Ada")),
      includeGenEd: false,
    });

    await expect(writeSubjectSnapshotToD1(instrumentedDb, largeSnapshot))
      .resolves.toEqual({ coursesCount: 1, sectionsCount: 1 });

    const counts = await testEnv.DB.prepare(`
      SELECT COUNT(*) AS meetings,
        (SELECT COUNT(*) FROM meeting_instructors mi
          JOIN meetings m ON m.id = mi.meeting_id
          WHERE m.section_id = ?) AS links
      FROM meetings WHERE section_id = ?
    `).bind(SECTION_ID, SECTION_ID).first<{ meetings: number; links: number }>();
    expect(counts).toEqual({ meetings: 1_001, links: 1_001 });
    expect(batches).toBe(1);
    expect(statementCount).toBeLessThan(20);
  });

  it("rolls back an earlier course update when a late section write fails", async () => {
    const published = snapshot({
      meetings: [meeting(0, "Lovelace", "Ada")],
      includeGenEd: false,
    });
    published.courses[0].course.title = "Published title";
    await writeSubjectSnapshotToD1(testEnv.DB, published);
    await testEnv.DB.prepare(`
      CREATE TRIGGER snapshot_test_abort BEFORE INSERT ON sections
      WHEN NEW.id = '${LATE_SECTION_ID}'
      BEGIN SELECT RAISE(ABORT, 'late section failure'); END
    `).run();

    const rejected = snapshot({
      meetings: [meeting(0, "Hopper", "Grace")],
      includeGenEd: true,
    });
    rejected.courses[0].course.title = "Must roll back";
    const firstSection = rejected.courses[0].sections[0];
    rejected.courses[0].sections.push({
      section: {
        ...firstSection.section,
        id: LATE_SECTION_ID,
        crn: "99999",
      },
      meetings: [{
        ...meeting(0, "Hopper", "Grace"),
        section_id: LATE_SECTION_ID,
      }],
    });

    await expect(writeSubjectSnapshotToD1(testEnv.DB, rejected))
      .rejects.toThrow("late section failure");
    await expect(testEnv.DB.prepare(
      "SELECT title FROM courses WHERE id = ?",
    ).bind(COURSE_ID).first()).resolves.toEqual({ title: "Published title" });
    await expect(testEnv.DB.prepare(
      "SELECT id FROM sections WHERE id = ?",
    ).bind(LATE_SECTION_ID).first()).resolves.toBeNull();
  });
});

function snapshot(options: {
  meetings: SubjectSnapshot["courses"][number]["sections"][number]["meetings"];
  includeGenEd: boolean;
}): SubjectSnapshot {
  return {
    subject: {
      id: "TST",
      name: "Test Studies",
    },
    courses: [
      {
        course: {
          id: COURSE_ID,
          subject: "TST",
          number: "100",
          title: "Snapshot reconciliation",
          description: null,
          credit_hours: 3,
          credit_hours_text: "3 hours.",
          year: 2026,
          term: "spring",
          avg_gpa: null,
          gpa_sample_size: null,
          primary_instructor: null,
          primary_instructor_rmp: null,
          difficulty_score: null,
          quality_score: null,
          subject_id: "TST",
          course_info: null,
          degree_attributes: null,
          class_schedule_info: null,
          date_range_text: null,
          registration_notes: null,
          approval_code: null,
        },
        sections: [
          {
            section: {
              id: SECTION_ID,
              crn: "98765",
              course_id: COURSE_ID,
              term_id: "2026-spring",
              section_number: "A",
              status: "Open",
              type: "Lecture",
              days: "MWF",
              start_time: "09:00",
              end_time: "09:50",
              location: "Test Hall",
              instructor: null,
              last_synced: SYNC_TIME,
              section_title: null,
              status_code: "A",
              section_status_code: "A",
              section_text: null,
              section_notes: null,
              capp_area: null,
              date_range_text: null,
              part_of_term: "1",
              start_date: null,
              end_date: null,
              credit_hours: "3",
            },
            meetings: options.meetings,
          },
        ],
        genEdCategories: options.includeGenEd
          ? [{
              categoryId: "HUM",
              categoryName: "Humanities",
              attributeCode: "LA",
              attributeName: "Literature and Arts",
            }]
          : [],
      },
    ],
    termId: "2026-spring",
    year: 2026,
    term: "spring",
    syncTimestamp: SYNC_TIME,
  };
}

function meeting(
  meetingIndex: number,
  lastName: string,
  firstName: string,
): SubjectSnapshot["courses"][number]["sections"][number]["meetings"][number] {
  return {
    section_id: SECTION_ID,
    meeting_index: meetingIndex,
    type_code: "LEC",
    type_name: "Lecture",
    days: "MWF",
    start_time: "09:00",
    end_time: "09:50",
    building_name: "Test Hall",
    room_number: String(100 + meetingIndex),
    date_range_text: null,
    instructors: [{ lastName, firstName }],
  };
}
