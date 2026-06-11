import { normalizeInstructorFirstName } from '../db/instructor-name.js';
import type { CourseGened, Instructor } from '../db/types.js';
import {
  formatInstructorName,
  type CourseGenEdSnapshot,
  type CourseSnapshot,
  type SubjectSnapshot,
} from '../transforms/course.js';

export type GenEdCleanup = {
  courseId: string;
  currentKeys: { categoryId: string; attributeCode: string | null }[];
};

export type SnapshotPersistenceOperation =
  | { kind: 'subject.upsert'; subject: SubjectSnapshot['subject'] }
  | { kind: 'course.upsert'; course: CourseSnapshot['course'] }
  | { kind: 'course_gened.upsert'; gened: Omit<CourseGened, 'id'> }
  | { kind: 'course_gened.prune_stale'; cleanup: GenEdCleanup }
  | { kind: 'section.upsert'; section: CourseSnapshot['sections'][number]['section'] }
  | { kind: 'instructor.upsert'; instructor: Omit<Instructor, 'id'> }
  | { kind: 'meeting.upsert'; meeting: Omit<CourseSnapshot['sections'][number]['meetings'][number], 'instructors'> }
  | {
      kind: 'meeting_instructor.link';
      sectionId: string;
      meetingIndex: number;
      lastName: string;
      firstName: string | null;
    }
  | {
      kind: 'subject.prune_stale_meeting_instructors';
      subjectId: string;
      year: number;
      term: string;
      syncTimestamp: number;
    }
  | {
      kind: 'subject.prune_stale_meetings';
      subjectId: string;
      year: number;
      term: string;
      syncTimestamp: number;
    }
  | {
      kind: 'subject.prune_stale_sections';
      subjectId: string;
      year: number;
      term: string;
      syncTimestamp: number;
    }
  | {
      kind: 'subject.prune_stale_course_geneds';
      subjectId: string;
      year: number;
      term: string;
      syncTimestamp: number;
    }
  | {
      kind: 'subject.prune_stale_courses';
      subjectId: string;
      year: number;
      term: string;
      syncTimestamp: number;
    };

export type SnapshotPersistencePlan = {
  writeOperations: SnapshotPersistenceOperation[];
  finalizeOperations: SnapshotPersistenceOperation[];
  coursesCount: number;
  sectionsCount: number;
};

export function subjectSnapshotPersistencePlan(
  snapshot: SubjectSnapshot
): SnapshotPersistencePlan {
  const writeOperations: SnapshotPersistenceOperation[] = [
    { kind: 'subject.upsert', subject: snapshot.subject },
  ];

  for (const courseSnapshot of snapshot.courses) {
    appendCourseWriteOperations(writeOperations, courseSnapshot);
  }

  const sectionPlan = sectionPersistenceOperations(snapshot.courses);
  writeOperations.push(...sectionPlan.operations);

  return {
    writeOperations,
    finalizeOperations: subjectStalePruneOperations(
      snapshot.subject.id,
      snapshot.year,
      snapshot.term,
      snapshot.syncTimestamp
    ),
    coursesCount: snapshot.courses.length,
    sectionsCount: sectionPlan.sectionsCount,
  };
}

function courseGenedPersistenceOperations(
  courseId: string,
  genEdCategories: CourseGenEdSnapshot[]
): SnapshotPersistenceOperation[] {
  const operations: SnapshotPersistenceOperation[] = [];

  for (const gened of genEdCategories) {
    operations.push({
      kind: 'course_gened.upsert',
      gened: courseGenedRow(courseId, gened),
    });
  }

  operations.push({
    kind: 'course_gened.prune_stale',
    cleanup: courseGenedCleanup(courseId, genEdCategories),
  });
  return operations;
}

function courseGenedCleanup(
  courseId: string,
  genEdCategories: CourseGenEdSnapshot[]
): GenEdCleanup {
  return {
    courseId,
    currentKeys: genEdCategories.map(gened => ({
      categoryId: gened.categoryId,
      attributeCode: gened.attributeCode,
    })),
  };
}

function appendCourseWriteOperations(
  operations: SnapshotPersistenceOperation[],
  snapshot: CourseSnapshot
): void {
  operations.push({ kind: 'course.upsert', course: snapshot.course });
  operations.push(...courseGenedPersistenceOperations(
    snapshot.course.id,
    snapshot.genEdCategories
  ));
}

function sectionPersistenceOperations(courses: CourseSnapshot[]): {
  operations: SnapshotPersistenceOperation[];
  sectionsCount: number;
} {
  const operations: SnapshotPersistenceOperation[] = [];
  const uniqueInstructors = new Map<string, Omit<Instructor, 'id'>>();
  const meetingLinks: Extract<SnapshotPersistenceOperation, { kind: 'meeting_instructor.link' }>[] = [];
  let sectionsCount = 0;

  for (const { sections } of courses) {
    for (const { section, meetings } of sections) {
      sectionsCount++;
      operations.push({ kind: 'section.upsert', section });

      for (const meetingData of meetings) {
        const { instructors, ...meeting } = meetingData;
        operations.push({ kind: 'meeting.upsert', meeting });

        for (const instructor of instructors) {
          const normalizedFirstName = normalizeInstructorFirstName(instructor.firstName);
          const instructorKey = `${instructor.lastName}\0${normalizedFirstName}`;
          if (!uniqueInstructors.has(instructorKey)) {
            uniqueInstructors.set(instructorKey, {
              first_name: normalizedFirstName,
              last_name: instructor.lastName,
              display_name: formatInstructorName(instructor) || instructor.lastName,
              rmp_rating: null,
              rmp_difficulty: null,
              avg_gpa: null,
              gpa_sample_size: null,
            });
          }

          meetingLinks.push({
            kind: 'meeting_instructor.link',
            sectionId: meeting.section_id,
            meetingIndex: meeting.meeting_index,
            lastName: instructor.lastName,
            firstName: normalizedFirstName,
          });
        }
      }
    }
  }

  for (const instructor of uniqueInstructors.values()) {
    operations.push({ kind: 'instructor.upsert', instructor });
  }
  operations.push(...meetingLinks);

  return { operations, sectionsCount };
}

function subjectStalePruneOperations(
  subjectId: string,
  year: number,
  term: string,
  syncTimestamp: number
): SnapshotPersistenceOperation[] {
  return [
    { kind: 'subject.prune_stale_meeting_instructors', subjectId, year, term, syncTimestamp },
    { kind: 'subject.prune_stale_meetings', subjectId, year, term, syncTimestamp },
    { kind: 'subject.prune_stale_sections', subjectId, year, term, syncTimestamp },
    { kind: 'subject.prune_stale_course_geneds', subjectId, year, term, syncTimestamp },
    { kind: 'subject.prune_stale_courses', subjectId, year, term, syncTimestamp },
  ];
}

function courseGenedRow(
  courseId: string,
  gened: CourseGenEdSnapshot
): Omit<CourseGened, 'id'> {
  return {
    course_id: courseId,
    category_id: gened.categoryId,
    category_name: gened.categoryName,
    attribute_code: gened.attributeCode ?? '',
    attribute_name: gened.attributeName,
  };
}
