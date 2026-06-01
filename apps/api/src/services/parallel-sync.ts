import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import {
  upsertSubject,
  prepareUpsertCourse,
  prepareUpsertSection,
  prepareInsertCourseGened,
  prepareUpsertMeeting,
  prepareUpsertInstructor,
  prepareLinkMeetingInstructorByKeys
} from '../db/index.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';
import { getUpstreamBackoff } from './upstream-backoff.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromSubjectCascade, formatInstructorName } from '../transforms/course.js';

type GenEdCleanup = {
  courseId: string;
  currentKeys: { categoryId: string; attributeCode: string | null }[];
};

const SUBJECT_SYNC_LOCK_TTL_SECONDS = 30 * 60;

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
  skipped?: boolean;
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
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;

  const response = await browserFetch(url);

  if (!response.ok) {
    if (upstreamBackoff.isRateLimited(response.status)) {
      const backoffMs = upstreamBackoff.recordFailure(
        `${subject}: HTTP ${response.status}`,
        response.status
      );
      throw new Error(`Rate limited on ${subject}, backing off ${backoffMs}ms`);
    }
    throw new Error(`HTTP ${response.status} for ${subject}`);
  }

  upstreamBackoff.recordSuccess();

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
  const syncTimestamp = coursesWithSections[0]?.course.last_synced ?? Math.floor(Date.now() / 1000);
  await upsertSubject(db, subject);

  let coursesCount = 0;
  let sectionsCount = 0;

  const courseStatements: any[] = [];
  const genedStatements: any[] = [];
  const sectionStatements: any[] = [];
  const meetingStatements: any[] = [];
  const instructorStatements: any[] = [];
  const linkStatements: any[] = [];
  const genedCleanup: GenEdCleanup[] = [];

  const coursesForEmbedding: any[] = [];
  const uniqueInstructors = new Set<string>();

  for (const { course, sections, genEdCategories } of coursesWithSections) {
    coursesCount++;
    courseStatements.push(prepareUpsertCourse(db, course));

    for (const cat of genEdCategories) {
      genedStatements.push(prepareInsertCourseGened(db, {
        course_id: course.id,
        category_id: cat.categoryId,
        category_name: cat.categoryName,
        attribute_code: cat.attributeCode,
        attribute_name: cat.attributeName
      }));
    }
    genedCleanup.push({
      courseId: course.id,
      currentKeys: genEdCategories.map(cat => ({
        categoryId: cat.categoryId,
        attributeCode: cat.attributeCode,
      })),
    });

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
            meeting.section_id,
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
  for (const cleanup of genedCleanup) {
    await pruneStaleCourseGeneds(db, cleanup);
  }
  await executeBatch(sectionStatements);
  await executeBatch(instructorStatements); // Upsert instructors first so they exist for linking
  await executeBatch(meetingStatements);    // Upsert meetings so they exist for linking
  await executeBatch(linkStatements);       // Link using subqueries
  await pruneStaleSubjectRows(db, subject.id, year, term, syncTimestamp);

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

async function pruneStaleCourseGeneds(db: D1Database, cleanup: GenEdCleanup): Promise<void> {
  if (cleanup.currentKeys.length === 0) {
    await db.prepare('DELETE FROM course_gened WHERE course_id = ?')
      .bind(cleanup.courseId)
      .run();
    return;
  }

  const keepClauses = cleanup.currentKeys
    .map(() => '(category_id = ? AND COALESCE(attribute_code, \'\') = ?)')
    .join(' OR ');
  const params = cleanup.currentKeys.flatMap(key => [key.categoryId, key.attributeCode ?? '']);

  await db.prepare(`
    DELETE FROM course_gened
    WHERE course_id = ?
      AND NOT (${keepClauses})
  `).bind(cleanup.courseId, ...params).run();
}

async function pruneStaleSubjectRows(
  db: D1Database,
  subjectId: string,
  year: number,
  term: string,
  syncTimestamp: number
): Promise<void> {
  await db.prepare(`
    DELETE FROM meeting_instructors
    WHERE meeting_id IN (
      SELECT m.id
      FROM meetings m
      JOIN sections s ON s.id = m.section_id
      JOIN courses c ON c.id = s.course_id
      WHERE c.subject = ? AND c.year = ? AND c.term = ?
        AND (s.last_synced IS NULL OR s.last_synced != ?)
    )
  `).bind(subjectId, year, term, syncTimestamp).run();

  await db.prepare(`
    DELETE FROM meetings
    WHERE section_id IN (
      SELECT s.id
      FROM sections s
      JOIN courses c ON c.id = s.course_id
      WHERE c.subject = ? AND c.year = ? AND c.term = ?
        AND (s.last_synced IS NULL OR s.last_synced != ?)
    )
  `).bind(subjectId, year, term, syncTimestamp).run();

  await db.prepare(`
    DELETE FROM sections
    WHERE course_id IN (
      SELECT id FROM courses WHERE subject = ? AND year = ? AND term = ?
    )
      AND (last_synced IS NULL OR last_synced != ?)
  `).bind(subjectId, year, term, syncTimestamp).run();

  await db.prepare(`
    DELETE FROM course_gened
    WHERE course_id IN (
      SELECT id FROM courses
      WHERE subject = ? AND year = ? AND term = ?
        AND (last_synced IS NULL OR last_synced != ?)
    )
  `).bind(subjectId, year, term, syncTimestamp).run();

  await db.prepare(`
    DELETE FROM courses
    WHERE subject = ? AND year = ? AND term = ?
      AND (last_synced IS NULL OR last_synced != ?)
  `).bind(subjectId, year, term, syncTimestamp).run();
}

export async function getSubjectsForTerm(
  config: ParallelSyncConfig,
  year: number,
  term: string
): Promise<string[]> {
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
  const response = await browserFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to get subjects: HTTP ${response.status}`);
  }

  upstreamBackoff.recordSuccess();

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
      const lockAcquired = await acquireSubjectSyncLock(db, termId, subject);
      if (!lockAcquired) {
        return {
          subject,
          success: true,
          skipped: true,
          coursesCount: 0,
          sectionsCount: 0,
          durationMs: Date.now() - subjectStart
        };
      }

      try {
        const parsed = await fetchSubjectCascade(config, year, term, subject);

        if (!parsed) {
          await updateSubjectSyncState(db, termId, subject, 'failed', 0, 0, 'Failed to parse response');
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
        await updateSubjectSyncState(db, termId, subject, 'complete', coursesCount, sectionsCount);

        return {
          subject,
          success: true,
          coursesCount,
          sectionsCount,
          durationMs: Date.now() - subjectStart
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await updateSubjectSyncState(db, termId, subject, 'failed', 0, 0, errorMsg);
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

  const upstreamBackoff = getUpstreamBackoff();
  const staleWarning = upstreamBackoff.getStaleDataWarning();

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

async function acquireSubjectSyncLock(db: D1Database, termId: string, subject: string): Promise<boolean> {
  const id = subjectSyncStateId(termId, subject);
  const existing = await db.prepare(`
    SELECT last_sync, last_status
    FROM sync_state
    WHERE id = ?
  `).bind(id).first<{ last_sync: number | null; last_status: string | null }>();

  const now = Math.floor(Date.now() / 1000);
  if (existing?.last_status === 'running' && existing.last_sync && now - existing.last_sync < SUBJECT_SYNC_LOCK_TTL_SECONDS) {
    return false;
  }

  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), 'running', 0, 0, NULL)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(id).run();

  return true;
}

async function updateSubjectSyncState(
  db: D1Database,
  termId: string,
  subject: string,
  status: string,
  coursesCount: number,
  sectionsCount: number,
  error?: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(subjectSyncStateId(termId, subject), status, coursesCount, sectionsCount, error ?? null).run();
}

function subjectSyncStateId(termId: string, subject: string): string {
  return `course-sync:${termId}:${subject}`;
}

export async function syncTerm(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<TermSyncResult> {
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
