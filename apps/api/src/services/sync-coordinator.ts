import type { D1Database, Fetcher, VectorizeIndex } from '@cloudflare/workers-types';
import type { TermState } from '../db/types.js';
import { getTermsByStatus } from '../db/term-state-repository.js';
import { internalAuthHeaders } from '../middleware/auth.js';
import { errorFields, logger } from '../observability/logger.js';
import {
  getSubjectsForTerm,
  type SubjectSyncResult,
  type TermSyncResult,
} from './parallel-sync.js';
import { MAX_SYNC_SUBJECTS_PER_REQUEST, type SyncBatchRequest } from './sync-batch-contract.js';
import {
  recordCoordinatedTermSyncFailure,
  recordCoordinatedTermSyncResult,
} from './course-sync-application.js';
import { syncEmbeddingsEnabled } from './sync-operations.js';
import { reconcileTermSubjectManifest } from './term-subject-manifest.js';
import { validateSyncBatchContract } from './validation.js';

type CourseSyncCoordinatorEnv = {
  DB: D1Database;
  SELF: Fetcher;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
  SYNC_EMBEDDINGS?: string;
  VECTORIZE?: VectorizeIndex;
  INTERNAL_TOKEN?: string;
};

export type CourseSyncTrigger = 'scheduled_course_sync' | 'admin_full_sync';

type CourseSyncCoordinatorOptions = {
  runId: string;
  cron: string;
  trigger: CourseSyncTrigger;
};

type CourseSyncTermResult = {
  termId: string;
  subjectCount: number;
  batchCount: number;
  failedBatchCount: number;
  failedSubjectCount: number;
  skippedSubjectCount: number;
  deletedCourseCount: number;
  success: boolean;
};

type CourseSyncCoordinatorResult = {
  termCount: number;
  results: CourseSyncTermResult[];
  failedTermCount: number;
};

export async function coordinateCourseSync(
  env: CourseSyncCoordinatorEnv,
  options: CourseSyncCoordinatorOptions
): Promise<CourseSyncCoordinatorResult> {
  logger.info('cron.courseSync.start', {
    runId: options.runId,
    cron: options.cron,
    trigger: options.trigger,
  });

  const activeTerms = [
    ...await getTermsByStatus(env.DB, 'registrable'),
    ...await getTermsByStatus(env.DB, 'active'),
  ];

  if (activeTerms.length === 0) {
    logger.info('cron.courseSync.noActiveTerms', { runId: options.runId });
    return { termCount: 0, results: [], failedTermCount: 0 };
  }

  const config = {
    cisapiBase: env.CISAPI_BASE,
    concurrency: parseInt(env.SYNC_CONCURRENCY, 10) || 25,
  };

  const results: CourseSyncTermResult[] = [];
  for (const termState of activeTerms) {
    results.push(await syncTermSubjects(env, config, termState, options.runId));
  }

  return {
    termCount: activeTerms.length,
    results,
    failedTermCount: results.filter(result => !result.success).length,
  };
}

type SubjectDiscoveryConfig = {
  cisapiBase: string;
  concurrency: number;
};

async function syncTermSubjects(
  env: CourseSyncCoordinatorEnv,
  config: SubjectDiscoveryConfig,
  termState: TermState,
  runId: string
): Promise<CourseSyncTermResult> {
  try {
    logger.info('cron.courseSync.subjects.start', { runId, termId: termState.term_id });
    const allSubjects = await getSubjectsForTerm(config, termState.year, termState.term);
    logger.info('cron.courseSync.subjects.complete', {
      runId,
      termId: termState.term_id,
      subjectCount: allSubjects.length,
    });

    const batches = chunk(allSubjects, MAX_SYNC_SUBJECTS_PER_REQUEST);
    logger.info('cron.courseSync.dispatch.start', {
      runId,
      termId: termState.term_id,
      batchCount: batches.length,
    });

    const dispatch = await dispatchSubjectBatches(
      env,
      termState,
      allSubjects.length,
      batches,
      runId
    );
    const aggregate = aggregateBatchResults(
      termState,
      dispatch.results,
      allSubjects.length
    );
    const skippedSubjectCount = aggregate.subjectResults.filter(subject => subject.skipped).length;
    const success = (
      dispatch.failedBatchCount === 0
      && aggregate.failedSubjects === 0
      && skippedSubjectCount === 0
      && aggregate.subjectResults.length === allSubjects.length
    );

    logger.info('cron.courseSync.dispatch.complete', {
      runId,
      termId: termState.term_id,
      batchCount: batches.length,
      failedBatchCount: dispatch.failedBatchCount,
      failedSubjectCount: aggregate.failedSubjects,
      skippedSubjectCount,
    });

    let deletedCourseCount = 0;
    if (success) {
      const reconciliation = await reconcileTermSubjectManifest(env.DB, {
        year: termState.year,
        term: termState.term,
        authoritativeSubjects: allSubjects,
        syncResult: aggregate,
        vectorize: syncEmbeddingsEnabled(env.SYNC_EMBEDDINGS)
          ? env.VECTORIZE
          : undefined,
      });
      if (!reconciliation.applied) {
        throw new Error(
          `Refusing incomplete subject-manifest reconciliation for ${termState.term_id}`,
        );
      }
      deletedCourseCount = reconciliation.deletedCourseCount;
      logger.info('cron.courseSync.manifest.complete', {
        runId,
        termId: termState.term_id,
        deletedCourseCount,
      });
    }

    await recordCoordinatedTermSyncResult(env.DB, {
      termState,
      result: aggregate,
      totalSubjects: allSubjects.length,
    });

    return {
      termId: termState.term_id,
      subjectCount: allSubjects.length,
      batchCount: batches.length,
      failedBatchCount: dispatch.failedBatchCount,
      failedSubjectCount: aggregate.failedSubjects,
      skippedSubjectCount,
      deletedCourseCount,
      success,
    };
  } catch (err) {
    logger.error('cron.courseSync.term.failed', {
      runId,
      termId: termState.term_id,
      ...errorFields(err),
    });
    try {
      await recordCoordinatedTermSyncFailure(
        env.DB,
        termState,
        err instanceof Error ? err.message : String(err)
      );
    } catch (stateError) {
      logger.error('cron.courseSync.termState.failed', {
        runId,
        termId: termState.term_id,
        ...errorFields(stateError),
      });
    }
    return {
      termId: termState.term_id,
      subjectCount: 0,
      batchCount: 0,
      failedBatchCount: 0,
      failedSubjectCount: 0,
      skippedSubjectCount: 0,
      deletedCourseCount: 0,
      success: false,
    };
  }
}

async function dispatchSubjectBatches(
  env: CourseSyncCoordinatorEnv,
  termState: TermState,
  totalSubjects: number,
  batches: string[][],
  runId: string
): Promise<{ results: TermSyncResult[]; failedBatchCount: number }> {
  const results: TermSyncResult[] = [];
  let failedBatchCount = 0;

  // Each internal batch already fans out subjects concurrently. Dispatching
  // batches serially bounds upstream concurrency and D1 write pressure.
  for (const [batchIndex, subjects] of batches.entries()) {
    const payload: SyncBatchRequest = {
      year: termState.year,
      term: termState.term,
      subjects,
      status: termState.status,
      totalSubjects,
    };

    try {
      const response = await env.SELF.fetch('http://internal/internal/sync-batch', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          ...internalAuthHeaders(env.INTERNAL_TOKEN),
        },
      });

      if (!response.ok) {
        throw new Error(`internal sync batch returned HTTP ${response.status}`);
      }

      const body: unknown = await response.json();
      const contractErrors = validateSyncBatchContract(body, {
        year: termState.year,
        term: termState.term,
        subjects,
      });
      if (contractErrors.length > 0) {
        throw new Error(`invalid internal sync result: ${contractErrors.join('; ')}`);
      }

      const result = body as unknown as TermSyncResult;
      const skippedSubjects = result.subjectResults.filter(subject => subject.skipped).length;
      if (result.failedSubjects > 0 || skippedSubjects > 0) {
        failedBatchCount += 1;
        logger.error('cron.courseSync.dispatch.subjectFailures', {
          runId,
          termId: termState.term_id,
          batchIndex,
          failedSubjects: result.failedSubjects,
          skippedSubjects,
        });
      }
      results.push(result);
    } catch (err) {
      failedBatchCount += 1;
      logger.error('cron.courseSync.dispatch.networkError', {
        runId,
        termId: termState.term_id,
        batchIndex,
        ...errorFields(err),
      });
      results.push(failedBatchResult(termState, subjects, err));
    }
  }

  return { results, failedBatchCount };
}

function failedBatchResult(
  termState: TermState,
  subjects: string[],
  error: unknown
): TermSyncResult {
  const message = error instanceof Error ? error.message : String(error);
  const subjectResults: SubjectSyncResult[] = subjects.map(subject => ({
    subject,
    success: false,
    coursesCount: 0,
    sectionsCount: 0,
    durationMs: 0,
    error: message,
  }));
  return {
    termId: termState.term_id,
    year: termState.year,
    term: termState.term,
    subjectResults,
    totalCourses: 0,
    totalSections: 0,
    successfulSubjects: 0,
    failedSubjects: subjectResults.length,
    durationMs: 0,
    rateLimitHits: 0,
    pagination: {
      total: subjects.length,
      offset: 0,
      limit: subjects.length,
      hasMore: false,
    },
  };
}

function aggregateBatchResults(
  termState: TermState,
  results: TermSyncResult[],
  totalSubjects: number
): TermSyncResult {
  const subjectResults = results.flatMap(result => result.subjectResults);
  const warnings = [
    ...new Set(results.map(result => result.staleDataWarning).filter((value): value is string => Boolean(value))),
  ];
  return {
    termId: termState.term_id,
    year: termState.year,
    term: termState.term,
    subjectResults,
    totalCourses: subjectResults.reduce((sum, subject) => sum + subject.coursesCount, 0),
    totalSections: subjectResults.reduce((sum, subject) => sum + subject.sectionsCount, 0),
    successfulSubjects: subjectResults.filter(subject => subject.success).length,
    failedSubjects: subjectResults.filter(subject => !subject.success).length,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    rateLimitHits: results.reduce((sum, result) => sum + result.rateLimitHits, 0),
    staleDataWarning: warnings.length > 0 ? warnings.join('; ') : undefined,
    pagination: {
      total: totalSubjects,
      offset: 0,
      limit: totalSubjects,
      hasMore: false,
    },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
