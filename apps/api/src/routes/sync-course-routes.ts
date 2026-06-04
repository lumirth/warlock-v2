import { Hono } from 'hono';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { syncTerm, syncSubjects } from '../services/parallel-sync.js';
import { validateSyncResult } from '../services/validation.js';
import { makeTermId } from '../db/ids.js';
import { getTermsByStatus, getTermState, upsertTermState } from '../db/term-state-repository.js';
import { TERM_STATUSES, type TermStateStatus } from '../db/types.js';
import { MAX_SYNC_SUBJECTS_PER_REQUEST, type SyncBatchRequest } from '../services/sync-batch-contract.js';
import { parseBoundedIntParam, parseEnumParam } from '../http/params.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import {
  parseForceRunningLocks,
  readTermAggregateCounts,
  refreshedSubjectCount,
  resolveManualSyncTermStatus,
  syncEmbeddingsEnabled,
  TERMS,
  type SyncRouteBindings,
} from './sync-shared.js';

export const syncCourseRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

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

    const parsedTerm = typeof term === 'string' ? parseEnumParam(term.toLowerCase(), 'term', TERMS) : { ok: false as const, error: 'term must be one of: winter, spring, summer, fall' };
    if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

    const normalizedSubjects = subjects.map(subject => typeof subject === 'string' ? subject.trim().toUpperCase() : '');
    if (normalizedSubjects.some(subject => !/^[A-Z]{2,4}$/.test(subject))) {
      return c.json({ error: 'subjects must be 2-4 letter subject codes' }, 400);
    }

    let requestedStatus: TermStateStatus | undefined;
    if (status !== undefined) {
      const parsedStatus = parseEnumParam(status, 'status', TERM_STATUSES);
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

    const config = {
      cisapiBase: c.env.CISAPI_BASE,
      concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
      offset: 0,
      limit: normalizedSubjects.length,
    };

    logger.info('internal.syncBatch.start', { runId, year: parsedYear, term: parsedTerm.value, subjectCount: normalizedSubjects.length });

    const result = await syncSubjects(
      c.env.DB,
      config,
      parsedYear,
      parsedTerm.value,
      normalizedSubjects,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.VECTORIZE : undefined,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.AI : undefined
    );

    const termId = makeTermId(parsedYear, parsedTerm.value);
    const existingTerm = await getTermState(c.env.DB, termId);
    const aggregateCounts = await readTermAggregateCounts(
      c.env.DB,
      termId,
      parsedYear,
      parsedTerm.value,
      parsedTotalSubjects ?? existingTerm?.subjects_count ?? result.pagination?.total ?? normalizedSubjects.length
    );
    const now = Math.floor(Date.now() / 1000);

    await upsertTermState(c.env.DB, {
      term_id: termId,
      year: parsedYear,
      term: parsedTerm.value,
      status: resolveManualSyncTermStatus(existingTerm, requestedStatus),
      last_checked: now,
      last_synced: refreshedSubjectCount(result) > 0 ? now : existingTerm?.last_synced ?? null,
      subjects_count: aggregateCounts.subjectsCount,
      courses_count: aggregateCounts.coursesCount,
      sections_count: aggregateCounts.sectionsCount,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
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

  const parsedTerm = parseEnumParam(term, 'term', TERMS);
  if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

  const parsedOffset = parseBoundedIntParam(c.req.query('offset'), 'offset', {
    min: 0,
    max: 10000,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return c.json({ error: parsedOffset.error }, 400);

  const parsedLimit = parseBoundedIntParam(c.req.query('limit'), 'limit', {
    min: 1,
    max: MAX_SYNC_SUBJECTS_PER_REQUEST,
    defaultValue: MAX_SYNC_SUBJECTS_PER_REQUEST,
  });
  if (!parsedLimit.ok) return c.json({ error: parsedLimit.error }, 400);

  const requestedStatusRaw = c.req.query('status');
  let requestedStatus: TermStateStatus | undefined;
  if (requestedStatusRaw !== undefined && requestedStatusRaw !== '') {
    const parsedStatus = parseEnumParam(requestedStatusRaw, 'status', TERM_STATUSES);
    if (!parsedStatus.ok) return c.json({ error: parsedStatus.error }, 400);
    requestedStatus = parsedStatus.value;
  }

  const forceRunningLocks = parseForceRunningLocks(c.req.query('force'));
  if (forceRunningLocks === null) {
    return c.json({ error: 'force must be true or false' }, 400);
  }

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset: parsedOffset.value,
    limit: parsedLimit.value,
  };

  try {
    const result = await syncTerm(
      c.env.DB,
      config,
      parsedYear.value,
      parsedTerm.value,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.VECTORIZE : undefined,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.AI : undefined,
      { lockMode: forceRunningLocks ? 'force' : 'respect-running' }
    );

    const termId = makeTermId(parsedYear.value, parsedTerm.value);
    const existingTerm = await getTermState(c.env.DB, termId);
    const aggregateCounts = await readTermAggregateCounts(
      c.env.DB,
      termId,
      parsedYear.value,
      parsedTerm.value,
      result.pagination?.total ?? result.successfulSubjects + result.failedSubjects
    );
    const now = Math.floor(Date.now() / 1000);
    await upsertTermState(c.env.DB, {
      term_id: termId,
      year: parsedYear.value,
      term: parsedTerm.value,
      status: resolveManualSyncTermStatus(existingTerm, requestedStatus),
      last_checked: now,
      last_synced: refreshedSubjectCount(result) > 0 ? now : existingTerm?.last_synced ?? null,
      subjects_count: aggregateCounts.subjectsCount,
      courses_count: aggregateCounts.coursesCount,
      sections_count: aggregateCounts.sectionsCount,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });

    const warnings = validateSyncResult(result);

    return c.json({ ...result, forceRunningLocks, warnings });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncCourseRoutes.post('/admin/sync-active', async (c) => {
  const activeTerms = [
    ...await getTermsByStatus(c.env.DB, 'registrable'),
    ...await getTermsByStatus(c.env.DB, 'active'),
  ];

  if (activeTerms.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  const parsedOffset = parseBoundedIntParam(c.req.query('offset'), 'offset', {
    min: 0,
    max: 10000,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return c.json({ error: parsedOffset.error }, 400);

  const parsedLimit = parseBoundedIntParam(c.req.query('limit'), 'limit', {
    min: 1,
    max: MAX_SYNC_SUBJECTS_PER_REQUEST,
    defaultValue: MAX_SYNC_SUBJECTS_PER_REQUEST,
  });
  if (!parsedLimit.ok) return c.json({ error: parsedLimit.error }, 400);

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset: parsedOffset.value,
    limit: parsedLimit.value,
  };

  const results = [];
  for (const termState of activeTerms) {
    const result = await syncTerm(
      c.env.DB,
      config,
      termState.year,
      termState.term,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.VECTORIZE : undefined,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.AI : undefined
    );

    const warnings = validateSyncResult(result);
    results.push({ ...result, warnings });
    const aggregateCounts = await readTermAggregateCounts(
      c.env.DB,
      termState.term_id,
      termState.year,
      termState.term,
      result.pagination?.total ?? termState.subjects_count ?? result.successfulSubjects + result.failedSubjects
    );

    const now = Math.floor(Date.now() / 1000);
    await upsertTermState(c.env.DB, {
      ...termState,
      last_checked: now,
      last_synced: refreshedSubjectCount(result) > 0 ? now : termState.last_synced,
      subjects_count: aggregateCounts.subjectsCount,
      courses_count: aggregateCounts.coursesCount,
      sections_count: aggregateCounts.sectionsCount,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });
  }

  return c.json({ results });
});
