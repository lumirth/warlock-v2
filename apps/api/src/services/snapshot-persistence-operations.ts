import { normalizeInstructorFirstName } from '../db/instructor-name.js';
import type { CourseGened, Instructor } from '../db/types.js';
import {
  formatInstructorName,
  type CourseGenEdSnapshot,
  type CourseSnapshot,
  type SubjectSnapshot,
} from '../transforms/course.js';

export type SubjectSnapshotManifest = {
  subjectId: string;
  year: number;
  term: string;
  courseIdsJson: string;
  sectionIdsJson: string;
  genEdKeysJson: string;
  meetingKeysJson: string;
  meetingInstructorKeysJson: string;
};

export type SnapshotPersistenceOperation =
  | { kind: 'subject.upsert'; subject: SubjectSnapshot['subject'] }
  | { kind: 'course.upsert'; course: CourseSnapshot['course'] }
  | { kind: 'course_gened.upsert'; gened: Omit<CourseGened, 'id'> }
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
      manifest: SubjectSnapshotManifest;
    }
  | {
      kind: 'subject.prune_stale_meetings';
      manifest: SubjectSnapshotManifest;
    }
  | {
      kind: 'subject.prune_stale_sections';
      manifest: SubjectSnapshotManifest;
    }
  | {
      kind: 'subject.prune_stale_course_geneds';
      manifest: SubjectSnapshotManifest;
    }
  | {
      kind: 'subject.prune_stale_courses';
      manifest: SubjectSnapshotManifest;
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
  const manifest = subjectSnapshotManifest(snapshot);

  return {
    writeOperations,
    finalizeOperations: subjectStalePruneOperations(manifest),
    coursesCount: snapshot.courses.length,
    sectionsCount: sectionPlan.sectionsCount,
  };
}

function courseGenedWriteOperations(
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

  return operations;
}

function appendCourseWriteOperations(
  operations: SnapshotPersistenceOperation[],
  snapshot: CourseSnapshot
): void {
  operations.push({ kind: 'course.upsert', course: snapshot.course });
  operations.push(...courseGenedWriteOperations(
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
  manifest: SubjectSnapshotManifest
): SnapshotPersistenceOperation[] {
  return [
    { kind: 'subject.prune_stale_meeting_instructors', manifest },
    { kind: 'subject.prune_stale_meetings', manifest },
    { kind: 'subject.prune_stale_sections', manifest },
    { kind: 'subject.prune_stale_course_geneds', manifest },
    { kind: 'subject.prune_stale_courses', manifest },
  ];
}

function subjectSnapshotManifest(
  snapshot: SubjectSnapshot
): SubjectSnapshotManifest {
  const courseIds: string[] = [];
  const sectionIds: string[] = [];
  const genEdKeys: Array<{
    courseId: string;
    categoryId: string;
    attributeCode: string;
  }> = [];
  const meetingKeys: Array<{
    sectionId: string;
    meetingIndex: number;
  }> = [];
  const meetingInstructorKeys: Array<{
    sectionId: string;
    meetingIndex: number;
    lastName: string;
    firstName: string;
  }> = [];

  for (const courseSnapshot of snapshot.courses) {
    courseIds.push(courseSnapshot.course.id);
    for (const gened of courseSnapshot.genEdCategories) {
      genEdKeys.push({
        courseId: courseSnapshot.course.id,
        categoryId: gened.categoryId,
        attributeCode: gened.attributeCode ?? '',
      });
    }

    for (const { section, meetings } of courseSnapshot.sections) {
      sectionIds.push(section.id);
      for (const meeting of meetings) {
        meetingKeys.push({
          sectionId: meeting.section_id,
          meetingIndex: meeting.meeting_index,
        });
        for (const instructor of meeting.instructors) {
          meetingInstructorKeys.push({
            sectionId: meeting.section_id,
            meetingIndex: meeting.meeting_index,
            lastName: instructor.lastName,
            firstName: normalizeInstructorFirstName(instructor.firstName),
          });
        }
      }
    }
  }

  return {
    subjectId: snapshot.subject.id,
    year: snapshot.year,
    term: snapshot.term,
    courseIdsJson: JSON.stringify(courseIds),
    sectionIdsJson: JSON.stringify(sectionIds),
    genEdKeysJson: JSON.stringify(genEdKeys),
    meetingKeysJson: JSON.stringify(meetingKeys),
    meetingInstructorKeysJson: JSON.stringify(meetingInstructorKeys),
  };
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
