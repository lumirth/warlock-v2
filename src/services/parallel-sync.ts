import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import { upsertCourse, upsertSection, makeCourseId, type Course, type Section } from '../db/index.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';
import { getRateLimiter } from './rate-limiter.js';

export interface ParallelSyncConfig {
  cisapiBase: string;
  concurrency: number;
}

export interface SubjectSyncResult {
  subject: string;
  success: boolean;
  coursesCount: number;
  sectionsCount: number;
  error?: string;
  durationMs: number;
}

export interface TermSyncResult {
  termId: string;
  year: number;
  term: string;
  subjectResults: SubjectSyncResult[];
  totalCourses: number;
  totalSections: number;
  successfulSubjects: number;
  failedSubjects: number;
  durationMs: number;
  rateLimitHits: number;
  staleDataWarning?: string;
}

async function fetchSubjectCascade(
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subject: string
): Promise<ParsedSubjectCascade | null> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/xml' }
  });

  if (!response.ok) {
    if (rateLimiter.isRateLimited(response.status)) {
      const backoffMs = rateLimiter.recordFailure(
        `${subject}: HTTP ${response.status}`,
        response.status
      );
      throw new Error(`Rate limited on ${subject}, backing off ${backoffMs}ms`);
    }
    throw new Error(`HTTP ${response.status} for ${subject}`);
  }

  rateLimiter.recordSuccess();

  const xml = await response.text();

  if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
    throw new Error(`HTML response for ${subject} (likely 404)`);
  }

  return parseSubjectCascadeXml(xml);
}

async function saveSubjectData(
  db: D1Database,
  parsed: ParsedSubjectCascade,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<{ coursesCount: number; sectionsCount: number }> {
  let coursesCount = 0;
  let sectionsCount = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const course of parsed.courses) {
    const courseId = makeCourseId(parsed.subjectId, course.id, year, term);

    const firstSection = course.sections.find(s =>
      s.type.toLowerCase().includes('lecture') || s.type.toLowerCase().includes('lec')
    ) ?? course.sections[0];

    const primaryInstructor = firstSection?.instructors[0];
    const primaryInstructorName = primaryInstructor
      ? `${primaryInstructor.lastName}, ${primaryInstructor.firstName.charAt(0)}`
      : null;

    const creditHours = parseInt(course.creditHours) || null;

    const courseData: Omit<Course, 'created_at' | 'updated_at'> = {
      id: courseId,
      subject: parsed.subjectId,
      number: course.id,
      title: course.title,
      description: course.description || null,
      credit_hours: creditHours,
      gened: course.genEdCategories[0] ?? null,
      year,
      term,
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: primaryInstructorName,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      last_synced: now
    };

    await upsertCourse(db, courseData);
    coursesCount++;

    if (vectorize && ai) {
      try {
        const embeddingData: CourseEmbeddingData = {
          id: courseId,
          subject: parsed.subjectId,
          number: course.id,
          title: course.title,
          description: course.description || null,
          gened: course.genEdCategories[0] ?? null,
          primary_instructor: primaryInstructorName
        };
        await upsertCourseEmbedding(vectorize, ai, embeddingData);
      } catch (e) {
        console.error(`Embedding error for ${courseId}:`, e);
      }
    }

    for (const section of course.sections) {
      const instructorName = section.instructors[0]
        ? `${section.instructors[0].lastName}, ${section.instructors[0].firstName.charAt(0)}`
        : null;

      const sectionData: Section = {
        crn: section.crn,
        course_id: courseId,
        section_number: section.sectionNumber || null,
        status: section.enrollmentStatus || null,
        type: section.type || null,
        days: section.daysOfTheWeek || null,
        start_time: section.startTime || null,
        end_time: section.endTime || null,
        location: `${section.buildingName} ${section.roomNumber}`.trim() || null,
        instructor: instructorName,
        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: now
      };

      await upsertSection(db, sectionData);
      sectionsCount++;
    }
  }

  return { coursesCount, sectionsCount };
}

async function getSubjectsForTerm(
  config: ParallelSyncConfig,
  year: number,
  term: string
): Promise<string[]> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/xml' }
  });

  if (!response.ok) {
    throw new Error(`Failed to get subjects: HTTP ${response.status}`);
  }

  rateLimiter.recordSuccess();

  const xml = await response.text();
  const subjectRegex = /<subject id="([^"]+)"/g;
  const subjects: string[] = [];
  let match;

  while ((match = subjectRegex.exec(xml)) !== null) {
    subjects.push(match[1]);
  }

  return subjects;
}

export async function syncTerm(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<TermSyncResult> {
  const startTime = Date.now();
  const termId = `${year}-${term}`;

  const subjects = await getSubjectsForTerm(config, year, term);

  const results: SubjectSyncResult[] = [];
  let rateLimitHits = 0;

  for (let i = 0; i < subjects.length; i += config.concurrency) {
    const batch = subjects.slice(i, i + config.concurrency);

    const batchPromises = batch.map(async (subject): Promise<SubjectSyncResult> => {
      const subjectStart = Date.now();

      try {
        const parsed = await fetchSubjectCascade(config, year, term, subject);

        if (!parsed) {
          return {
            subject,
            success: false,
            coursesCount: 0,
            sectionsCount: 0,
            error: 'Failed to parse response',
            durationMs: Date.now() - subjectStart
          };
        }

        const { coursesCount, sectionsCount } = await saveSubjectData(
          db, parsed, year, term, vectorize, ai
        );

        return {
          subject,
          success: true,
          coursesCount,
          sectionsCount,
          durationMs: Date.now() - subjectStart
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('Rate limited')) {
          rateLimitHits++;
        }

        return {
          subject,
          success: false,
          coursesCount: 0,
          sectionsCount: 0,
          error: errorMsg,
          durationMs: Date.now() - subjectStart
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const rateLimiter = getRateLimiter();
  const staleWarning = rateLimiter.getStaleDataWarning();

  return {
    termId,
    year,
    term,
    subjectResults: results,
    totalCourses: results.reduce((sum, r) => sum + r.coursesCount, 0),
    totalSections: results.reduce((sum, r) => sum + r.sectionsCount, 0),
    successfulSubjects: results.filter(r => r.success).length,
    failedSubjects: results.filter(r => !r.success).length,
    durationMs: Date.now() - startTime,
    rateLimitHits,
    staleDataWarning: staleWarning ?? undefined
  };
}
