import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { CISAPIClient } from '../cisapi/client.js';
import { upsertCourse, upsertSection, makeCourseId, type Course, type Section } from '../db/index.js';
import { convertTo24Hour } from '../cisapi/parser.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';

export interface SyncResult {
  subject: string;
  coursesProcessed: number;
  sectionsProcessed: number;
  embeddingsGenerated: number;
  errors: string[];
  durationMs: number;
}

export interface SyncOptions {
  year: string;
  term: string;
}

export async function syncSubject(
  db: D1Database,
  client: CISAPIClient,
  subjectId: string,
  options: SyncOptions,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    subject: subjectId,
    coursesProcessed: 0,
    sectionsProcessed: 0,
    embeddingsGenerated: 0,
    errors: [],
    durationMs: 0
  };

  try {
    // Get all courses for this subject
    const courses = await client.getCourses(subjectId);

    for (const course of courses) {
      try {
        // Fetch full course detail with sections
        const detail = await client.getCourseDetail(subjectId, course.id);

        if (!detail) {
          result.errors.push(`No detail found for ${subjectId} ${course.id}`);
          continue;
        }

        const courseId = makeCourseId(subjectId, course.id, parseInt(options.year), options.term);
        const now = Math.floor(Date.now() / 1000);

        // Parse credit hours (could be "3" or "3 to 4")
        const creditHours = parseInt(detail.creditHours) || null;

        // Get primary instructor from first lecture section
        const lectureSection = detail.sections.find(s =>
          s.meetings.some(m => m.typeCode === 'LEC' || m.type === 'Lecture')
        );
        const primaryInstructor = lectureSection?.meetings[0]?.instructors[0];
        const primaryInstructorName = primaryInstructor
          ? `${primaryInstructor.lastName}, ${primaryInstructor.firstName.charAt(0)}`
          : null;

        // Get genEd (first category if any)
        const gened = detail.genEdCategories[0]?.id ?? null;

        // Upsert course
        const courseData: Omit<Course, 'created_at' | 'updated_at'> = {
          id: courseId,
          subject: subjectId,
          number: course.id,
          title: detail.label,
          description: detail.description || null,
          credit_hours: creditHours,
          gened,
          year: parseInt(options.year),
          term: options.term,
          avg_gpa: null,
          gpa_sample_size: null,
          primary_instructor: primaryInstructorName,
          primary_instructor_rmp: null,
          difficulty_score: null,
          quality_score: null,
          last_synced: now
        };

        await upsertCourse(db, courseData);
        result.coursesProcessed++;

        // Generate and store embedding if vectorize and AI are available
        if (vectorize && ai) {
          try {
            const embeddingData: CourseEmbeddingData = {
              id: courseId,
              subject: subjectId,
              number: course.id,
              title: detail.label,
              description: detail.description || null,
              gened,
              primary_instructor: primaryInstructorName
            };
            await upsertCourseEmbedding(vectorize, ai, embeddingData);
            result.embeddingsGenerated++;
          } catch (embError) {
            result.errors.push(`Embedding error for ${courseId}: ${String(embError)}`);
          }
        }

        // Upsert sections
        for (const section of detail.sections) {
          const meeting = section.meetings[0];

          const instructorName = meeting?.instructors[0]
            ? `${meeting.instructors[0].lastName}, ${meeting.instructors[0].firstName.charAt(0)}`
            : null;

          const sectionData: Section = {
            crn: section.crn,
            course_id: courseId,
            section_number: section.sectionNumber || null,
            status: section.enrollmentStatus || null,
            type: meeting?.type || null,
            days: meeting?.daysOfTheWeek || null,
            start_time: convertTo24Hour(meeting?.start || '') || null,
            end_time: convertTo24Hour(meeting?.end || '') || null,
            location: meeting ? `${meeting.buildingName} ${meeting.roomNumber}`.trim() : null,
            instructor: instructorName,
            instructor_rmp: null,
            instructor_gpa: null,
            last_synced: now
          };

          await upsertSection(db, sectionData);
          result.sectionsProcessed++;
        }

      } catch (error) {
        result.errors.push(`Error syncing ${subjectId} ${course.id}: ${String(error)}`);
      }
    }

  } catch (error) {
    result.errors.push(`Error fetching courses for ${subjectId}: ${String(error)}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
