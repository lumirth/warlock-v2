import { makeCourseId } from '../db/ids.js';
import { resolveTermContext } from './term-state.js';
import type {
  CourseDetailContext,
  CourseDetailRequest,
  CourseDetailServiceEnv,
} from './course-detail-types.js';

export async function createCourseDetailContext(
  env: CourseDetailServiceEnv,
  request: CourseDetailRequest
): Promise<CourseDetailContext> {
  const resolvedTerm = await resolveTermContext(env.DB, {
    requestedYear: request.requestedYear,
    requestedTerm: request.requestedTerm,
    fallbackYear: env.CURRENT_YEAR,
    fallbackTerm: env.CURRENT_TERM,
  });
  const term = resolvedTerm.term;

  return {
    subject: request.subject,
    number: request.number,
    resolvedTerm,
    year: String(resolvedTerm.year),
    term,
    termId: resolvedTerm.termId,
    courseId: makeCourseId(request.subject, request.number, resolvedTerm.year, term),
    cacheTtlMs: parseInt(env.CLIENT_CACHE_TTL_MS, 10) || 30000,
  };
}
