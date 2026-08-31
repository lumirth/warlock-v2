import type { D1Database } from '@cloudflare/workers-types';
import type { TermState } from '../db/types.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import {
  getSubjectsForTerm,
  type ParallelSyncConfig,
  SUBJECT_LEASE_TTL_SECONDS,
  syncSubjects,
} from './parallel-sync.js';
import { reconcileTermSubjectManifest } from './term-subject-manifest.js';
import { syncConcurrency } from './sync-operations.js';

const SUBJECTS_PER_STEP = 20;

type Env = {
  DB: D1Database;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
};

type SubjectState = {
  subject: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | null;
  lastSync: number | null;
};

type TermPlan = {
  term: TermState;
  subjects: string[];
  states: SubjectState[];
};

type Work = {
  plan: TermPlan;
  subjects: string[];
};

export type CourseSyncStep = {
  catalogReady: boolean;
  processed: {
    termId: string;
    subjects: string[];
    failedSubjects: number;
  } | null;
  terms: Array<{
    termId: string;
    total: number;
    complete: number;
    failed: number;
    running: number;
  }>;
};

export async function coordinateCourseSync(
  env: Env,
  options: { runId?: string; refresh?: boolean } = {},
): Promise<CourseSyncStep> {
  const runId = options.runId ?? createRunId('course-sync');
  const config = {
    cisapiBase: env.CISAPI_BASE,
    concurrency: syncConcurrency(env.SYNC_CONCURRENCY),
  };
  let plans = await loadPlans(env.DB, config, runId);
  const work = chooseRecoveryWork(plans) ?? (options.refresh ? chooseRefreshWork(plans) : null);
  let processed: CourseSyncStep['processed'] = null;

  if (work) {
    const result = await syncSubjects(
      env.DB,
      config,
      work.plan.term.year,
      work.plan.term.term,
      work.subjects,
    );
    processed = {
      termId: work.plan.term.term_id,
      subjects: work.subjects,
      failedSubjects: result.failedSubjects,
    };
    if (result.failedSubjects) {
      logger.error('courseSync.step.failed', {
        runId,
        termId: work.plan.term.term_id,
        failedSubjects: result.failedSubjects,
      });
    }
    plans = await reloadPlan(env.DB, plans, work.plan.term.term_id);
  }

  for (const plan of plans.filter(isReady)) await publishTerm(env.DB, plan);
  return response(plans, processed);
}

async function loadPlans(
  db: D1Database,
  config: ParallelSyncConfig,
  runId: string,
): Promise<TermPlan[]> {
  const terms = await db.prepare(`
    SELECT * FROM term_state WHERE status IN ('registrable', 'active')
    ORDER BY CASE status WHEN 'registrable' THEN 0 ELSE 1 END, year DESC
  `).all<TermState>();
  return Promise.all(terms.results.map(async term => {
    let subjects: string[];
    try {
      subjects = await getSubjectsForTerm(config, term.year, term.term);
      rejectImplausibleShrink(term, subjects.length);
    } catch (error) {
      logger.error('courseSync.term.failed', { runId, termId: term.term_id, ...errorFields(error) });
      return { term, subjects: [], states: [] };
    }
    return { term, subjects, states: await loadStates(db, term.term_id, subjects) };
  }));
}

async function loadStates(
  db: D1Database,
  termId: string,
  subjects: string[],
): Promise<SubjectState[]> {
  const result = await db.prepare(`
    SELECT CAST(manifest.value AS TEXT) AS subject,
      state.status, state.last_sync AS lastSync
    FROM json_each(?) AS manifest
    LEFT JOIN subject_sync_state AS state
      ON state.term_id = ? AND state.subject = CAST(manifest.value AS TEXT)
    ORDER BY subject
  `).bind(JSON.stringify(subjects), termId).all<SubjectState>();
  return result.results;
}

function chooseRecoveryWork(plans: TermPlan[]): Work | null {
  const now = Math.floor(Date.now() / 1_000);
  const candidates = plans.flatMap((plan, termOrder) => plan.states
    .map(state => ({ plan, state, termOrder, priority: recoveryPriority(state, now) }))
    .filter(candidate => candidate.priority !== null)
  ).sort((left, right) =>
    (left.priority ?? 0) - (right.priority ?? 0)
      || (left.state.lastSync ?? 0) - (right.state.lastSync ?? 0)
      || left.termOrder - right.termOrder
      || left.state.subject.localeCompare(right.state.subject));
  const selected = candidates[0];
  if (!selected) return null;
  return {
    plan: selected.plan,
    subjects: candidates
      .filter(candidate => candidate.plan === selected.plan)
      .slice(0, SUBJECTS_PER_STEP)
      .map(candidate => candidate.state.subject),
  };
}

function recoveryPriority(state: SubjectState, now: number): number | null {
  if (state.status === null || state.status === 'pending') return 0;
  if (state.status === 'failed') return 1;
  if (state.status === 'running'
    && (state.lastSync === null || state.lastSync <= now - SUBJECT_LEASE_TTL_SECONDS)) return 1;
  return null;
}

function chooseRefreshWork(plans: TermPlan[]): Work | null {
  if (!plans.length || plans.some(plan => !isReady(plan))) return null;
  const plan = [...plans].sort((left, right) =>
    oldestSync(left) - oldestSync(right)
      || plans.indexOf(left) - plans.indexOf(right))[0];
  if (!plan) return null;
  return {
    plan,
    subjects: [...plan.states]
      .sort((left, right) => (left.lastSync ?? 0) - (right.lastSync ?? 0)
        || left.subject.localeCompare(right.subject))
      .slice(0, SUBJECTS_PER_STEP)
      .map(state => state.subject),
  };
}

function oldestSync(plan: TermPlan): number {
  return Math.min(...plan.states.map(state => state.lastSync ?? 0));
}

async function reloadPlan(db: D1Database, plans: TermPlan[], termId: string): Promise<TermPlan[]> {
  const plan = plans.find(candidate => candidate.term.term_id === termId);
  if (!plan) return plans;
  const replacement = { ...plan, states: await loadStates(db, termId, plan.subjects) };
  return plans.map(candidate => candidate === plan ? replacement : candidate);
}

async function publishTerm(db: D1Database, plan: TermPlan): Promise<void> {
  const reconciliation = await reconcileTermSubjectManifest(db, {
    year: plan.term.year,
    term: plan.term.term,
    authoritativeSubjects: plan.subjects,
  });
  if (!reconciliation.applied) return;
  const manifest = JSON.stringify(plan.subjects);
  await db.prepare(`
    UPDATE term_state SET
      last_synced = (
        SELECT MIN(state.last_sync) FROM json_each(?) AS manifest
        JOIN subject_sync_state AS state
          ON state.term_id = ? AND state.subject = CAST(manifest.value AS TEXT)
      ),
      subjects_count = ?,
      courses_count = (SELECT COUNT(*) FROM courses WHERE year = ? AND term = ?),
      sections_count = (
        SELECT COUNT(*) FROM sections JOIN courses ON courses.id = sections.course_id
        WHERE courses.year = ? AND courses.term = ?
      ),
      sync_errors = NULL
    WHERE term_id = ?
  `).bind(
    manifest,
    plan.term.term_id,
    plan.subjects.length,
    plan.term.year,
    plan.term.term,
    plan.term.year,
    plan.term.term,
    plan.term.term_id,
  ).run();
}

function response(plans: TermPlan[], processed: CourseSyncStep['processed']): CourseSyncStep {
  return {
    catalogReady: plans.length > 0 && plans.every(isReady),
    processed,
    terms: plans.map(plan => ({
      termId: plan.term.term_id,
      total: plan.states.length,
      complete: count(plan, 'complete'),
      failed: count(plan, 'failed'),
      running: count(plan, 'running'),
    })),
  };
}

function isReady(plan: TermPlan): boolean {
  return plan.subjects.length > 0
    && plan.states.length === plan.subjects.length
    && plan.states.every(state => state.status === 'complete');
}

function count(plan: TermPlan, status: SubjectState['status']): number {
  return plan.states.filter(state => state.status === status).length;
}

function rejectImplausibleShrink(term: TermState, nextCount: number): void {
  if (term.subjects_count && term.subjects_count >= 20 && nextCount * 4 < term.subjects_count * 3) {
    throw new Error(`refusing subject shrink from ${term.subjects_count} to ${nextCount}`);
  }
}
