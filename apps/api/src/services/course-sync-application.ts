import type { Ai, D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import { makeTermId } from '../db/ids.js';
import { getTermsByStatus, getTermState, upsertTermState } from '../db/term-state-repository.js';
import type { TermState, TermStateStatus } from '../db/types.js';
import {
  syncTerm,
  syncSubjects,
  type ParallelSyncConfig,
  type TermSyncResult,
} from './parallel-sync.js';
import {
  readTermAggregateCounts,
  resolveManualSyncTermStatus,
  syncEmbeddingsEnabled,
  type SyncRouteBindings,
} from './sync-operations.js';
import { validateSyncResult } from './validation.js';

type CourseSyncApplicationEnv = Pick<
  SyncRouteBindings,
  'DB' | 'CISAPI_BASE' | 'SYNC_CONCURRENCY' | 'SYNC_EMBEDDINGS' | 'VECTORIZE' | 'AI'
>;

type SyncSubjectBatchCommand = {
  year: number;
  term: string;
  subjects: string[];
  requestedStatus?: TermStateStatus;
  totalSubjects?: number | null;
};

type SyncTermCommand = {
  year: number;
  term: string;
  offset: number;
  limit: number;
  requestedStatus?: TermStateStatus;
  forceRunningLocks?: boolean;
};

type SyncActiveTermsCommand = {
  offset: number;
  limit: number;
};

type ManualTermSyncResult = TermSyncResult & {
  forceRunningLocks: boolean;
  warnings: string[];
};

type ActiveTermsSyncResult = {
  results: Array<TermSyncResult & { warnings: string[] }>;
};

export async function runSubjectSyncBatch(
  env: CourseSyncApplicationEnv,
  command: SyncSubjectBatchCommand
): Promise<TermSyncResult> {
  const result = await syncSubjects(
    env.DB,
    syncConfig(env, { offset: 0, limit: command.subjects.length }),
    command.year,
    command.term,
    command.subjects,
    embeddingVectorize(env),
    embeddingAi(env)
  );

  return result;
}

export async function runManualTermSync(
  env: CourseSyncApplicationEnv,
  command: SyncTermCommand
): Promise<ManualTermSyncResult> {
  const result = await syncTerm(
    env.DB,
    syncConfig(env, { offset: command.offset, limit: command.limit }),
    command.year,
    command.term,
    embeddingVectorize(env),
    embeddingAi(env),
    { lockMode: command.forceRunningLocks ? 'force' : 'respect-running' }
  );

  await recordTermSyncResult(env.DB, {
    year: command.year,
    term: command.term,
    result,
    requestedStatus: command.requestedStatus,
    totalSubjects: result.pagination?.total ?? result.successfulSubjects + result.failedSubjects,
    fullCorpus: isFullCorpusResult(result),
  });

  return {
    ...result,
    forceRunningLocks: Boolean(command.forceRunningLocks),
    warnings: validateSyncResult(result),
  };
}

export async function runActiveTermsSync(
  env: CourseSyncApplicationEnv,
  command: SyncActiveTermsCommand
): Promise<ActiveTermsSyncResult> {
  const activeTerms = [
    ...await getTermsByStatus(env.DB, 'registrable'),
    ...await getTermsByStatus(env.DB, 'active'),
  ];

  const results = [];
  for (const termState of activeTerms) {
    const result = await syncTerm(
      env.DB,
      syncConfig(env, { offset: command.offset, limit: command.limit }),
      termState.year,
      termState.term,
      embeddingVectorize(env),
      embeddingAi(env)
    );

    await recordTermSyncResult(env.DB, {
      year: termState.year,
      term: termState.term,
      result,
      existingTerm: termState,
      totalSubjects: result.pagination?.total
        ?? termState.subjects_count
        ?? result.successfulSubjects + result.failedSubjects,
      fullCorpus: isFullCorpusResult(result),
    });

    results.push({ ...result, warnings: validateSyncResult(result) });
  }

  return { results };
}

type RecordTermSyncOptions = {
  year: number;
  term: string;
  result: TermSyncResult;
  requestedStatus?: TermStateStatus;
  existingTerm?: TermState | null;
  totalSubjects?: number;
  fullCorpus: boolean;
};

export async function recordCoordinatedTermSyncResult(
  db: D1Database,
  options: {
    termState: TermState;
    result: TermSyncResult;
    totalSubjects: number;
  }
): Promise<void> {
  await recordTermSyncResult(db, {
    year: options.termState.year,
    term: options.termState.term,
    result: options.result,
    existingTerm: options.termState,
    totalSubjects: options.totalSubjects,
    fullCorpus: true,
  });
}

export async function recordCoordinatedTermSyncFailure(
  db: D1Database,
  termState: TermState,
  error: string
): Promise<void> {
  await upsertTermState(db, {
    term_id: termState.term_id,
    year: termState.year,
    term: termState.term,
    status: termState.status,
    last_checked: Math.floor(Date.now() / 1000),
    last_synced: termState.last_synced,
    subjects_count: termState.subjects_count,
    courses_count: termState.courses_count,
    sections_count: termState.sections_count,
    sync_errors: JSON.stringify({
      complete: false,
      coverage: 'coordinator',
      error,
    }),
  });
}

async function recordTermSyncResult(
  db: D1Database,
  options: RecordTermSyncOptions
): Promise<void> {
  const termId = makeTermId(options.year, options.term);
  const existingTerm = options.existingTerm ?? await getTermState(db, termId);
  const aggregateCounts = await readTermAggregateCounts(
    db,
    termId,
    options.year,
    options.term,
    options.totalSubjects
      ?? existingTerm?.subjects_count
      ?? options.result.pagination?.total
      ?? options.result.successfulSubjects + options.result.failedSubjects
  );
  const now = Math.floor(Date.now() / 1000);
  const expectedSubjects = options.totalSubjects
    ?? options.result.pagination?.total
    ?? options.result.subjectResults.length;
  const skippedSubjects = options.result.subjectResults.filter(subject => subject.skipped).length;
  const fullySuccessful = (
    options.fullCorpus
    && expectedSubjects > 0
    && options.result.subjectResults.length === expectedSubjects
    && options.result.successfulSubjects === expectedSubjects
    && options.result.failedSubjects === 0
    && skippedSubjects === 0
  );

  await upsertTermState(db, {
    ...(existingTerm ?? {
      term_id: termId,
      year: options.year,
      term: options.term,
      status: 'active' as TermStateStatus,
    }),
    term_id: termId,
    year: options.year,
    term: options.term,
    status: resolveManualSyncTermStatus(existingTerm, options.requestedStatus),
    last_checked: now,
    last_synced: fullySuccessful ? now : existingTerm?.last_synced ?? null,
    subjects_count: aggregateCounts.subjectsCount,
    courses_count: aggregateCounts.coursesCount,
    sections_count: aggregateCounts.sectionsCount,
    sync_errors: syncErrors(options.result, {
      fullySuccessful,
      fullCorpus: options.fullCorpus,
      expectedSubjects,
      skippedSubjects,
    }),
  });
}

function syncErrors(
  result: TermSyncResult,
  summary: {
    fullySuccessful: boolean;
    fullCorpus: boolean;
    expectedSubjects: number;
    skippedSubjects: number;
  }
): string | null {
  if (summary.fullySuccessful) return null;
  return JSON.stringify({
    complete: false,
    coverage: summary.fullCorpus ? 'full' : 'partial',
    expectedSubjects: summary.expectedSubjects,
    attemptedSubjects: result.subjectResults.length,
    failedSubjects: result.failedSubjects,
    skippedSubjects: summary.skippedSubjects,
    errors: result.subjectResults
      .filter(subject => !subject.success)
      .map(subject => ({ subject: subject.subject, error: subject.error ?? 'unknown failure' })),
  });
}

function isFullCorpusResult(result: TermSyncResult): boolean {
  const pagination = result.pagination;
  return Boolean(
    pagination
    && pagination.offset === 0
    && pagination.hasMore === false
    && result.subjectResults.length === pagination.total
  );
}

function syncConfig(
  env: CourseSyncApplicationEnv,
  page: { offset?: number; limit?: number } = {}
): ParallelSyncConfig {
  return {
    cisapiBase: env.CISAPI_BASE,
    concurrency: parseInt(env.SYNC_CONCURRENCY, 10) || 25,
    ...page,
  };
}

function embeddingVectorize(env: CourseSyncApplicationEnv): VectorizeIndex | undefined {
  return syncEmbeddingsEnabled(env.SYNC_EMBEDDINGS) ? env.VECTORIZE : undefined;
}

function embeddingAi(env: CourseSyncApplicationEnv): Ai | undefined {
  return syncEmbeddingsEnabled(env.SYNC_EMBEDDINGS) ? env.AI : undefined;
}
