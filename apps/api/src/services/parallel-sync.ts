import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import {
  upsertSubject,
  upsertMeeting,
  upsertInstructor,
  linkMeetingInstructor,
  deleteCourseGeneds,
  prepareUpsertCourse,
  prepareUpsertSection,
  prepareInsertCourseGened,
  prepareUpsertMeeting,
  prepareUpsertInstructor,
  prepareLinkMeetingInstructorByKeys
} from '../db/index.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';
import { getRateLimiter } from './rate-limiter.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromSubjectCascade, formatInstructorName } from '../transforms/course.js';

export interface ParallelSyncConfig {
  cisapiBase: string;
  concurrency: number;
  offset?: number;
  limit?: number;
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
  pagination?: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
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

  const response = await browserFetch(url);

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

  // Use streaming parser to avoid loading entire XML into memory
  if (!response.body) {
     // Fallback if no body (shouldn't happen with fetch)
     const xml = await response.text();
     if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
       throw new Error(`HTML response for ${subject} (likely 404)`);
     }
     // Create a stream from the text
     const stream = new ReadableStream({
       start(controller) {
         controller.enqueue(new TextEncoder().encode(xml));
         controller.close();
       }
     });
     return parseSubjectCascadeXml(stream);
  }

  return parseSubjectCascadeXml(response.body);
}

async function saveSubjectData(
  db: D1Database,
  parsed: ParsedSubjectCascade,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<{ coursesCount: number; sectionsCount: number }> {
  const { subject, coursesWithSections } = fromSubjectCascade(parsed, year, term);
  await upsertSubject(db, subject);

  let coursesCount = 0;
  let sectionsCount = 0;

  const courseStatements: any[] = [];
  const genedStatements: any[] = [];
  const sectionStatements: any[] = [];
  const meetingStatements: any[] = [];
  const instructorStatements: any[] = [];
  const linkStatements: any[] = [];

  const coursesForEmbedding: any[] = [];
  const uniqueInstructors = new Set<string>();

  for (const { course, sections, genEdCategories } of coursesWithSections) {
    coursesCount++;
    courseStatements.push(prepareUpsertCourse(db, course));

    // Delete existing GenEds first (linear for now as we didn't prepare it)
    await deleteCourseGeneds(db, course.id);

    for (const cat of genEdCategories) {
      genedStatements.push(prepareInsertCourseGened(db, {
        course_id: course.id,
        category_id: cat.categoryId,
        category_name: cat.categoryName,
        attribute_code: cat.attributeCode,
        attribute_name: cat.attributeName
      }));
    }

    if (vectorize && ai) {
      coursesForEmbedding.push(course);
    }

    for (const { section, meetings } of sections) {
      sectionsCount++;
      sectionStatements.push(prepareUpsertSection(db, section));

      for (const meetingData of meetings) {
        const { instructors, ...meeting } = meetingData;
        meetingStatements.push(prepareUpsertMeeting(db, meeting));

        for (const instructor of instructors) {
          const instructorKey = `${instructor.lastName}|${instructor.firstName || ''}`;
          if (!uniqueInstructors.has(instructorKey)) {
            uniqueInstructors.add(instructorKey);
            instructorStatements.push(prepareUpsertInstructor(db, {
              first_name: instructor.firstName || null,
              last_name: instructor.lastName,
              display_name: formatInstructorName(instructor) || instructor.lastName,
              rmp_rating: null,
              rmp_difficulty: null,
              avg_gpa: null,
              gpa_sample_size: null
            }));
          }

          linkStatements.push(prepareLinkMeetingInstructorByKeys(
            db,
            meeting.section_crn,
            meeting.meeting_index,
            instructor.lastName,
            instructor.firstName || null
          ));
        }
      }
    }
  }

  // Execute batches in chunks to avoid limits
  const BATCH_SIZE = 50;

  const executeBatch = async (stmts: any[]) => {
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const chunk = stmts.slice(i, i + BATCH_SIZE);
      if (chunk.length > 0) await db.batch(chunk);
    }
  };

  // Order matters for FK constraints and linking logic
  await executeBatch(courseStatements);
  await executeBatch(genedStatements);
  await executeBatch(sectionStatements);
  await executeBatch(instructorStatements); // Upsert instructors first so they exist for linking
  await executeBatch(meetingStatements);    // Upsert meetings so they exist for linking
  await executeBatch(linkStatements);       // Link using subqueries

  // Process Embeddings
  if (vectorize && ai) {
    // Process embeddings in parallel chunks to speed up
    const EMBEDDING_CONCURRENCY = 5;
    for (let i = 0; i < coursesForEmbedding.length; i += EMBEDDING_CONCURRENCY) {
      const chunk = coursesForEmbedding.slice(i, i + EMBEDDING_CONCURRENCY);
      await Promise.all(chunk.map(async (course: any) => {
        try {
          const embeddingData: CourseEmbeddingData = {
            id: course.id,
            subject: course.subject,
            number: course.number,
            title: course.title,
            description: course.description,
            gened: course.gened,
            primary_instructor: course.primary_instructor
          };
          await upsertCourseEmbedding(vectorize, ai, embeddingData);
        } catch (e) {
          console.error(`Embedding error for ${course.id}:`, e);
        }
      }));
    }
  }

  return { coursesCount, sectionsCount };
}

export async function getSubjectsForTerm(
  config: ParallelSyncConfig,
  year: number,
  term: string
): Promise<string[]> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
  const response = await browserFetch(url);

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

export async function syncSubjects(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subjects: string[],
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<TermSyncResult> {
  const startTime = Date.now();
  const termId = `${year}-${term}`;

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
    staleDataWarning: staleWarning ?? undefined,
    pagination: {
      total: subjects.length,
      offset: 0,
      limit: subjects.length,
      hasMore: false
    }
  };
}

export async function syncTerm(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<TermSyncResult> {
  const termId = `${year}-${term}`;

  const allSubjects = await getSubjectsForTerm(config, year, term);
  const totalSubjects = allSubjects.length;

  // Apply pagination - default to 20 subjects per request to stay well under Workers subrequest limit
  const offset = config.offset ?? 0;
  const limit = config.limit ?? 20;
  const subjects = allSubjects.slice(offset, offset + limit);
  const hasMore = offset + limit < totalSubjects;

  const result = await syncSubjects(db, config, year, term, subjects, vectorize, ai);

  // Update pagination info since syncSubjects doesn't know about the global list
  if (result.pagination) {
    result.pagination.total = totalSubjects;
    result.pagination.offset = offset;
    result.pagination.limit = limit;
    result.pagination.hasMore = hasMore;
  }

  return result;
}
