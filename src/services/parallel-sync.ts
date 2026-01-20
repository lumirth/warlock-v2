import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import { upsertCourse, upsertSection } from '../db/index.js';
import { upsertCourseEmbedding, type CourseEmbeddingData } from './embeddings.js';
import { getRateLimiter } from './rate-limiter.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromSubjectCascade } from '../transforms/course.js';

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
  const coursesWithSections = fromSubjectCascade(parsed, year, term);
  let coursesCount = 0;
  let sectionsCount = 0;

  for (const { course, sections } of coursesWithSections) {
    await upsertCourse(db, course);
    coursesCount++;

    if (vectorize && ai) {
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
    }

    for (const section of sections) {
      await upsertSection(db, section);
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

  const allSubjects = await getSubjectsForTerm(config, year, term);
  const totalSubjects = allSubjects.length;

  // Apply pagination - default to 20 subjects per request to stay well under Workers subrequest limit
  const offset = config.offset ?? 0;
  const limit = config.limit ?? 20;
  const subjects = allSubjects.slice(offset, offset + limit);
  const hasMore = offset + limit < totalSubjects;

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
      total: totalSubjects,
      offset,
      limit,
      hasMore
    }
  };
}
