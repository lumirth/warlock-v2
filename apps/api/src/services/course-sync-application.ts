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
  refreshedSubjectCount,
  resolveManualSyncTermStatus,
  syncEmbeddingsEnabled,
  type SyncRouteBindings,
} from './sync-operations.js';
import { validateSyncResult } from './validation.js';

export type CourseSyncApplicationEnv = Pick<
  SyncRouteBindings,
  'DB' | 'CISAPI_BASE' | 'SYNC_CONCURRENCY' | 'SYNC_EMBEDDINGS' | 'VECTORIZE' | 'AI'
>;

export type SyncSubjectBatchCommand = {
  year: number;
  term: string;
  subjects: string[];
  requestedStatus?: TermStateStatus;
  totalSubjects?: number | null;
};

export type SyncTermCommand = {
  year: number;
  term: string;
  offset: number;
  limit: number;
  requestedStatus?: TermStateStatus;
  forceRunningLocks?: boolean;
};

export type SyncActiveTermsCommand = {
  offset: number;
  limit: number;
};

export type ManualTermSyncResult = TermSyncResult & {
  forceRunningLocks: boolean;
  warnings: string[];
};

export type ActiveTermsSyncResult = {
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

  await recordTermSyncResult(env.DB, {
    year: command.year,
    term: command.term,
    result,
    requestedStatus: command.requestedStatus,
    totalSubjects: command.totalSubjects ?? undefined,
  });

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
};

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
    last_synced: refreshedSubjectCount(options.result) > 0
      ? now
      : existingTerm?.last_synced ?? null,
    subjects_count: aggregateCounts.subjectsCount,
    courses_count: aggregateCounts.coursesCount,
    sections_count: aggregateCounts.sectionsCount,
    sync_errors: syncErrors(options.result),
  });
}

function syncErrors(result: TermSyncResult): string | null {
  if (result.failedSubjects === 0) return null;
  return JSON.stringify(result.subjectResults.filter(subject => !subject.success).map(subject => subject.error));
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
