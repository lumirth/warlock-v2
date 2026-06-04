import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import type { TermState } from '../db/types.js';
import { getTermsByStatus, touchTermStateChecked } from '../db/term-state-repository.js';
import { internalAuthHeaders } from '../middleware/auth.js';
import { errorFields, logger } from '../observability/logger.js';
import { getSubjectsForTerm } from './parallel-sync.js';
import { MAX_SYNC_SUBJECTS_PER_REQUEST, type SyncBatchRequest } from './sync-batch-contract.js';

export type CourseSyncCoordinatorEnv = {
  DB: D1Database;
  SELF: Fetcher;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
  INTERNAL_TOKEN?: string;
};

export type CourseSyncTrigger = 'default_cron' | 'gpa_resume_fallthrough';

export type CourseSyncCoordinatorOptions = {
  runId: string;
  cron: string;
  trigger: CourseSyncTrigger;
};

export type CourseSyncTermResult = {
  termId: string;
  subjectCount: number;
  batchCount: number;
  failedBatchCount: number;
  success: boolean;
};

export type CourseSyncCoordinatorResult = {
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

  const results = await Promise.all(
    activeTerms.map(termState => syncTermSubjects(env, config, termState, options.runId))
  );

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

    const failedBatchCount = await dispatchSubjectBatches(env, termState, allSubjects.length, batches, runId);

    logger.info('cron.courseSync.dispatch.complete', {
      runId,
      termId: termState.term_id,
      batchCount: batches.length,
      failedBatchCount,
    });

    await touchTermStateChecked(env.DB, termState.term_id, Math.floor(Date.now() / 1000));

    return {
      termId: termState.term_id,
      subjectCount: allSubjects.length,
      batchCount: batches.length,
      failedBatchCount,
      success: failedBatchCount === 0,
    };
  } catch (err) {
    logger.error('cron.courseSync.term.failed', {
      runId,
      termId: termState.term_id,
      ...errorFields(err),
    });
    return {
      termId: termState.term_id,
      subjectCount: 0,
      batchCount: 0,
      failedBatchCount: 0,
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
): Promise<number> {
  const failedBatches = await Promise.all(batches.map(async (subjects, batchIndex) => {
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
        logger.error('cron.courseSync.dispatch.failed', {
          runId,
          termId: termState.term_id,
          batchIndex,
          responseStatus: response.status,
        });
        return true;
      }
      return false;
    } catch (err) {
      logger.error('cron.courseSync.dispatch.networkError', {
        runId,
        termId: termState.term_id,
        batchIndex,
        ...errorFields(err),
      });
      return true;
    }
  }));

  return failedBatches.filter(Boolean).length;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
