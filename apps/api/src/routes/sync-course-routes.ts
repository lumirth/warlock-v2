import { Hono } from 'hono';
import {
  SEARCH_TERM_VALUES,
  TERM_STATUS_VALUES,
  type TermStatus,
} from '@uiuc-course-search/query-types';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { MAX_SYNC_SUBJECTS_PER_REQUEST, type SyncBatchRequest } from '../services/sync-batch-contract.js';
import {
  parseBoundedIntParam,
  parseEnumParam,
  type ParsedParam,
} from '../http/params.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import {
  runActiveTermsSync,
  runManualTermSync,
  runSubjectSyncBatch,
} from '../services/course-sync-application.js';
import {
  parseForceRunningLocks,
  type SyncRouteBindings,
} from '../services/sync-operations.js';

export const syncCourseRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

function parseSyncPagination(
  offset: string | undefined,
  limit: string | undefined,
): ParsedParam<{ offset: number; limit: number }> {
  const parsedOffset = parseBoundedIntParam(offset, 'offset', {
    min: 0,
    max: 10000,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return parsedOffset;

  const parsedLimit = parseBoundedIntParam(limit, 'limit', {
    min: 1,
    max: MAX_SYNC_SUBJECTS_PER_REQUEST,
    defaultValue: MAX_SYNC_SUBJECTS_PER_REQUEST,
  });
  if (!parsedLimit.ok) return parsedLimit;

  return {
    ok: true,
    value: { offset: parsedOffset.value, limit: parsedLimit.value },
  };
}

syncCourseRoutes.post('/internal/sync-batch', async (c) => {
  const runId = createRunId('sync-batch');
  try {
    const { year, term, subjects, status, totalSubjects } = await c.req.json<SyncBatchRequest>();

    if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
      return c.json({ error: 'No subjects provided' }, 400);
    }
    if (subjects.length > MAX_SYNC_SUBJECTS_PER_REQUEST) {
      return c.json({ error: `subjects must contain at most ${MAX_SYNC_SUBJECTS_PER_REQUEST} entries` }, 400);
    }

    const parsedYear = typeof year === 'number' && Number.isInteger(year) && year >= 2004 && year <= new Date().getFullYear() + 5
      ? year
      : null;
    if (parsedYear === null) {
      return c.json({ error: 'year must be an integer between 2004 and five years from now' }, 400);
    }

    const parsedTerm = typeof term === 'string'
      ? parseEnumParam(term.toLowerCase(), 'term', SEARCH_TERM_VALUES)
      : {
          ok: false as const,
          error: `term must be one of: ${SEARCH_TERM_VALUES.join(', ')}`,
        };
    if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

    const normalizedSubjects = subjects.map(subject => typeof subject === 'string' ? subject.trim().toUpperCase() : '');
    if (normalizedSubjects.some(subject => !/^[A-Z]{2,4}$/.test(subject))) {
      return c.json({ error: 'subjects must be 2-4 letter subject codes' }, 400);
    }

    let requestedStatus: TermStatus | undefined;
    if (status !== undefined) {
      const parsedStatus = parseEnumParam(status, 'status', TERM_STATUS_VALUES);
      if (!parsedStatus.ok) return c.json({ error: parsedStatus.error }, 400);
      requestedStatus = parsedStatus.value;
    }

    const parsedTotalSubjects = totalSubjects === undefined
      ? null
      : Number.isInteger(totalSubjects) && totalSubjects >= normalizedSubjects.length
        ? totalSubjects
        : undefined;
    if (parsedTotalSubjects === undefined) {
      return c.json({ error: 'totalSubjects must be an integer greater than or equal to subjects.length' }, 400);
    }

    logger.info('internal.syncBatch.start', { runId, year: parsedYear, term: parsedTerm.value, subjectCount: normalizedSubjects.length });

    const result = await runSubjectSyncBatch(c.env, {
      year: parsedYear,
      term: parsedTerm.value,
      subjects: normalizedSubjects,
      requestedStatus,
      totalSubjects: parsedTotalSubjects,
    });

    return c.json(result);
  } catch (error) {
    logger.error('internal.syncBatch.failed', { runId, ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});

syncCourseRoutes.post('/admin/discover-terms', async (c) => {
  const config = {
    frontendBase: c.env.FRONTEND_BASE,
    cisapiBase: c.env.CISAPI_BASE,
  };

  try {
    const classifications = await discoverAndClassifyTerms(c.env.DB, config);
    return c.json({
      discovered: classifications.length,
      terms: classifications.map(cl => ({
        termId: cl.term.termId,
        year: cl.term.year,
        term: cl.term.term,
        status: cl.status,
        sampleStatuses: cl.sampleEnrollmentStatuses
      }))
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncCourseRoutes.post('/admin/sync/:year/:term', async (c) => {
  const { year, term } = c.req.param();
  const parsedYear = parseBoundedIntParam(year, 'year', { min: 2004, max: new Date().getFullYear() + 2 });
  if (!parsedYear.ok) return c.json({ error: parsedYear.error }, 400);

  const parsedTerm = parseEnumParam(term, 'term', SEARCH_TERM_VALUES);
  if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

  const pagination = parseSyncPagination(c.req.query('offset'), c.req.query('limit'));
  if (!pagination.ok) return c.json({ error: pagination.error }, 400);

  const requestedStatusRaw = c.req.query('status');
  let requestedStatus: TermStatus | undefined;
  if (requestedStatusRaw !== undefined && requestedStatusRaw !== '') {
    const parsedStatus = parseEnumParam(requestedStatusRaw, 'status', TERM_STATUS_VALUES);
    if (!parsedStatus.ok) return c.json({ error: parsedStatus.error }, 400);
    requestedStatus = parsedStatus.value;
  }

  const forceRunningLocks = parseForceRunningLocks(c.req.query('force'));
  if (forceRunningLocks === null) {
    return c.json({ error: 'force must be true or false' }, 400);
  }

  try {
    const result = await runManualTermSync(c.env, {
      year: parsedYear.value,
      term: parsedTerm.value,
      ...pagination.value,
      requestedStatus,
      forceRunningLocks,
    });

    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncCourseRoutes.post('/admin/sync-active', async (c) => {
  const pagination = parseSyncPagination(c.req.query('offset'), c.req.query('limit'));
  if (!pagination.ok) return c.json({ error: pagination.error }, 400);

  const result = await runActiveTermsSync(c.env, {
    ...pagination.value,
  });

  if (result.results.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  return c.json(result);
});
