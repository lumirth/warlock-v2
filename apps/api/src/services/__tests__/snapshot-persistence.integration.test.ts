import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { SubjectSnapshot } from "../../transforms/course.js";
import { writeSubjectSnapshotToD1 } from "../course-snapshot-writer.js";

const testEnv = env as { DB: D1Database };
const SYNC_TIME = 1_780_000_000;
const COURSE_ID = "TST-100-2026-spring";
const SECTION_ID = "2026-spring-98765";

describe("subject snapshot reconciliation", () => {
  beforeEach(async () => {
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
          id, subject, number, title, year, term, subject_id, last_synced
        ) VALUES (
          'TST-200-2026-spring', 'TST', '200', 'Removed course',
          2026, 'spring', 'TST', ?
        )
      `).bind(SYNC_TIME),
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
    await testEnv.DB.prepare(
      "UPDATE courses SET title = 'Current published title' WHERE id = ?",
    ).bind(COURSE_ID).run();
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

    const afterCurrentPublication = await testEnv.DB.prepare(
      "SELECT title FROM courses WHERE id = ?",
    ).bind(COURSE_ID).first<{ title: string }>();
    const fenceRows = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM subject_sync_publication_fences",
    ).first<{ count: number }>();
    expect(afterCurrentPublication?.title).toBe("Current owner title");
    expect(fenceRows?.count).toBe(0);
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
      college_code: null,
      department_code: null,
      unit_name: null,
      contact_name: null,
      contact_title: null,
      address_line1: null,
      address_line2: null,
      phone_number: null,
      website_url: null,
      description: null,
      last_synced: SYNC_TIME,
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
          last_synced: SYNC_TIME,
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
              instructor_rmp: null,
              instructor_gpa: null,
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
