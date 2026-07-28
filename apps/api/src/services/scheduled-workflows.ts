import type {
  D1Database,
  Fetcher,
  KVNamespace,
  VectorizeIndex,
} from '@cloudflare/workers-types';
import { coordinateEnrichment, enrichCoursesWithGpa } from './enrichment.js';
import {
  claimGpaCompletionPublication,
  finishGpaCompletionEnrichment,
  releaseGpaMutationLease,
  resumeGpaSync,
  resetGpaSync,
} from './gpa-sync.js';
import { coordinateRmpSync } from './rmp-sync.js';
import { coordinateCourseSync, type CourseSyncTrigger } from './sync-coordinator.js';
import { discoverAndClassifyTerms } from './term-discovery.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';

type ScheduledWorkflowEnv = {
  DB: D1Database;
  SELF: Fetcher;
  VECTORIZE?: VectorizeIndex;
  GPA_CACHE: KVNamespace;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
  SYNC_EMBEDDINGS?: string;
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

type ScheduledWorkflow =
  | { name: 'term_discovery'; trigger: 'daily_term_discovery' }
  | { name: 'weekly_maintenance'; trigger: 'weekly_maintenance' }
  | { name: 'gpa_resume'; trigger: 'gpa_resume_cron' }
  | { name: 'course_sync'; trigger: CourseSyncTrigger };

type ScheduledWorkflowPlan = {
  cron: string;
  workflows: ScheduledWorkflow[];
};

type ScheduledWorkflowDispatch = {
  cron: string;
  env: ScheduledWorkflowEnv;
  waitUntil: (workflow: Promise<void>) => void;
};

const TERM_DISCOVERY_CRON = '0 10,22 * * *';
const COURSE_SYNC_CRON = '30 10,22 * * *';
const WEEKLY_MAINTENANCE_CRON = '0 8 * * SUN';
const GPA_RESUME_CRON = '*/5 * * * *';

export function planScheduledWorkflows(cron: string): ScheduledWorkflowPlan {
  if (cron === TERM_DISCOVERY_CRON) {
    return {
      cron,
      workflows: [{ name: 'term_discovery', trigger: 'daily_term_discovery' }],
    };
  }

  if (cron === WEEKLY_MAINTENANCE_CRON) {
    return {
      cron,
      workflows: [{ name: 'weekly_maintenance', trigger: 'weekly_maintenance' }],
    };
  }

  if (cron === GPA_RESUME_CRON) {
    return {
      cron,
      workflows: [{ name: 'gpa_resume', trigger: 'gpa_resume_cron' }],
    };
  }

  if (cron === COURSE_SYNC_CRON) {
    return {
      cron,
      workflows: [{ name: 'course_sync', trigger: 'scheduled_course_sync' }],
    };
  }

  return {
    cron,
    workflows: [],
  };
}

export function dispatchScheduledWorkflows(
  input: ScheduledWorkflowDispatch
): ScheduledWorkflowPlan {
  const runId = createRunId('cron');
  const plan = planScheduledWorkflows(input.cron);

  for (const workflow of plan.workflows) {
    input.waitUntil(runScheduledWorkflow(workflow, input.env, runId, plan.cron));
  }

  return plan;
}

async function runScheduledWorkflow(
  workflow: ScheduledWorkflow,
  env: ScheduledWorkflowEnv,
  runId: string,
  cron: string
): Promise<void> {
  switch (workflow.name) {
    case 'term_discovery':
      return handleTermDiscovery(env, runId, cron);
    case 'weekly_maintenance':
      return handleWeeklyMaintenance(env, runId, cron);
    case 'gpa_resume':
      return handleGpaResume(env, runId, cron);
    case 'course_sync':
      return handleCourseSync(env, runId, cron, workflow.trigger);
  }
}

async function handleTermDiscovery(env: ScheduledWorkflowEnv, runId: string, cron: string): Promise<void> {
  logger.info('cron.termDiscovery.start', { runId, cron });
  try {
    const classifications = await discoverAndClassifyTerms(env.DB, {
      cisapiBase: env.CISAPI_BASE,
    });
    const active = classifications.filter(c => c.status === 'active');
    const registrable = classifications.filter(c => c.status === 'registrable');
    logger.info('cron.termDiscovery.complete', {
      runId,
      termCount: classifications.length,
      registrableTermCount: registrable.length,
      registrableTerms: registrable.map(c => c.term.termId).join(','),
      activeTermCount: active.length,
      activeTerms: active.map(c => c.term.termId).join(','),
    });
  } catch (err) {
    logger.error('cron.termDiscovery.failed', { runId, ...errorFields(err) });
  }
}

async function handleWeeklyMaintenance(env: ScheduledWorkflowEnv, runId: string, cron: string): Promise<void> {
  let gpaResetResult: string | null = null;
  logger.info('cron.weekly.gpaReset.start', { runId, cron });
  try {
    gpaResetResult = await resetGpaSync(env.DB, env.GPA_CACHE);
    logger.info('cron.weekly.gpaReset.complete', { runId, result: gpaResetResult });
  } catch (err) {
    logger.error('cron.weekly.gpaReset.failed', { runId, ...errorFields(err) });
  }

  logger.info('cron.weekly.rmp.start', { runId, cron });
  try {
    const rmpResult = await coordinateRmpSync(env.DB, env.SELF, {
      rmpAuthToken: env.RMP_AUTH_TOKEN,
      internalToken: env.INTERNAL_TOKEN,
    });
    logger.info('cron.weekly.rmp.complete', { runId, ...rmpResult });

    // A newly reset GPA generation will perform this once at completion. If
    // GPA did not change (or the reset check failed), publish the fresh RMP
    // data now instead of racing a concurrent GPA reset.
    if (gpaResetResult === null || gpaResetResult === 'skipped_no_changes') {
      logger.info('cron.weekly.rmp.enrichment.start', { runId });
      const enrichment = await coordinateEnrichment(env.DB);
      logger.info('cron.weekly.rmp.enrichment.complete', { runId, ...enrichment });
    }
  } catch (err) {
    logger.error('cron.weekly.rmp.failed', { runId, ...errorFields(err) });
  }
}

async function handleGpaResume(env: ScheduledWorkflowEnv, runId: string, cron: string): Promise<void> {
  logger.info('cron.gpaResume.start', { runId, cron });
  try {
    const result = await resumeGpaSync(env.DB, env.GPA_CACHE);
    logger.info('cron.gpaResume.chunkComplete', {
      runId,
      rowsProcessed: result.rowsProcessed,
      isComplete: result.isComplete,
    });

    if (result.isComplete && result.completionKey) {
      const publicationLease = await claimGpaCompletionPublication(env.DB, result.completionKey);
      if (!publicationLease) {
        logger.info('cron.gpaResume.enrichment.alreadyHandled', {
          runId,
          completionKey: result.completionKey,
        });
        return;
      }

      logger.info('cron.gpaResume.enrichment.start', { runId });
      try {
        try {
          await enrichCoursesWithGpa(env.DB);
          await coordinateEnrichment(env.DB);
          await finishGpaCompletionEnrichment(env.DB, result.completionKey, 'complete');
          logger.info('cron.gpaResume.enrichment.complete', { runId });
        } catch (error) {
          await finishGpaCompletionEnrichment(env.DB, result.completionKey, 'failed');
          throw error;
        }
      } finally {
        await releaseGpaMutationLease(env.DB, publicationLease);
      }
    }
  } catch (err) {
    logger.error('cron.gpaResume.failed', { runId, ...errorFields(err) });
  }
}

async function handleCourseSync(
  env: ScheduledWorkflowEnv,
  runId: string,
  cron: string,
  trigger: CourseSyncTrigger
): Promise<void> {
  try {
    await coordinateCourseSync(env, { runId, cron, trigger });
  } catch (err) {
    logger.error('cron.courseSync.failed', { runId, cron, trigger, ...errorFields(err) });
  }
}
