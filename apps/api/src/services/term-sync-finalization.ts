import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import { getTermState } from '../db/term-state-repository.js';
import type { SubjectSyncState, TermState } from '../db/types.js';
import {
  recordCoordinatedTermSyncResult,
} from './course-sync-application.js';
import {
  getSubjectsForTerm,
  type SubjectSyncResult,
  type TermSyncResult,
} from './parallel-sync.js';
import { syncEmbeddingsEnabled } from './sync-operations.js';
import { reconcileTermSubjectManifest } from './term-subject-manifest.js';

type TermSyncFinalizationEnv = {
  DB: D1Database;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
  SYNC_EMBEDDINGS?: string;
  VECTORIZE?: VectorizeIndex;
};

type FinalizeTermSyncCommand = {
  year: number;
  term: string;
  minimumLastSync: number;
  expectedManifestSha256: string;
};

export type TermSyncFinalizationResult = {
  success: true;
  termId: string;
  year: number;
  term: string;
  status: 'registrable' | 'active';
  subjectCount: number;
  completeSubjectCount: number;
  removedSubjectCount: number;
  deletedCourseCount: number;
  coursesCount: number;
  sectionsCount: number;
  minimumLastSync: number;
  earliestSubjectSync: number;
  manifestSha256: string;
  lastSynced: number;
};

/**
 * Publishes term-level freshness after independently proving that every
 * subject in a freshly fetched Course Explorer manifest has a durable,
 * successful checkpoint.
 */
export async function finalizeTermSync(
  env: TermSyncFinalizationEnv,
  command: FinalizeTermSyncCommand,
): Promise<TermSyncFinalizationResult> {
  if (!isPositiveInteger(command.minimumLastSync)) {
    throw new Error('Term finalization requires a valid sync lower bound.');
  }
  if (!/^[a-f0-9]{64}$/.test(command.expectedManifestSha256)) {
    throw new Error('Term finalization requires a valid manifest SHA-256.');
  }
  const termId = `${command.year}-${command.term}`;
  const termState = await requireReleasableTerm(
    env.DB,
    termId,
    command.year,
    command.term,
  );
  const authoritativeSubjects = await getSubjectsForTerm(
    {
      cisapiBase: env.CISAPI_BASE,
      concurrency: parseInt(env.SYNC_CONCURRENCY, 10) || 1,
    },
    command.year,
    command.term,
  );
  rejectImplausibleManifestShrink(termState, authoritativeSubjects.length);
  const manifestSha256 = await hashSubjectManifest(authoritativeSubjects);
  if (manifestSha256 !== command.expectedManifestSha256) {
    throw new Error(
      `Term finalization manifest changed during paged sync for ${termId}.`,
    );
  }
  const authoritativeSet = new Set(authoritativeSubjects);
  const beforeReconciliation = await readTermSubjectStates(env.DB, termId);
  const completedStates = requireCompleteAuthoritativeCoverage(
    termId,
    authoritativeSubjects,
    beforeReconciliation,
    command.minimumLastSync,
  );
  const removedSubjectCount = beforeReconciliation.filter(
    state => !authoritativeSet.has(state.subject),
  ).length;
  const syncResult = fullSyncResult(
    command.year,
    command.term,
    completedStates,
  );

  const reconciliation = await reconcileTermSubjectManifest(env.DB, {
    year: command.year,
    term: command.term,
    authoritativeSubjects,
    syncResult,
    vectorize: syncEmbeddingsEnabled(env.SYNC_EMBEDDINGS)
      ? env.VECTORIZE
      : undefined,
  });
  if (!reconciliation.applied) {
    throw new Error(
      `Term finalization refused incomplete manifest evidence for ${termId}.`,
    );
  }

  const finalizedStates = await readTermSubjectStates(env.DB, termId);
  requireExactFinalCoverage(
    termId,
    authoritativeSubjects,
    finalizedStates,
    command.minimumLastSync,
  );
  await recordCoordinatedTermSyncResult(env.DB, {
    termState,
    result: syncResult,
    totalSubjects: authoritativeSubjects.length,
  });

  const finalizedTerm = await getTermState(env.DB, termId);
  if (
    !finalizedTerm
    || finalizedTerm.last_synced === null
    || !Number.isSafeInteger(finalizedTerm.last_synced)
    || finalizedTerm.last_synced <= 0
    || finalizedTerm.subjects_count !== authoritativeSubjects.length
    || !isNonNegativeInteger(finalizedTerm.courses_count)
    || !isNonNegativeInteger(finalizedTerm.sections_count)
    || finalizedTerm.sync_errors !== null
  ) {
    throw new Error(
      `Term finalization did not publish complete freshness for ${termId}.`,
    );
  }

  return {
    success: true,
    termId,
    year: command.year,
    term: command.term,
    status: termState.status,
    subjectCount: authoritativeSubjects.length,
    completeSubjectCount: finalizedStates.length,
    removedSubjectCount,
    deletedCourseCount: reconciliation.deletedCourseCount,
    coursesCount: finalizedTerm.courses_count,
    sectionsCount: finalizedTerm.sections_count,
    minimumLastSync: command.minimumLastSync,
    earliestSubjectSync: Math.min(
      ...finalizedStates.map(state => state.last_sync!),
    ),
    manifestSha256,
    lastSynced: finalizedTerm.last_synced,
  };
}

function rejectImplausibleManifestShrink(
  termState: TermState,
  authoritativeSubjectCount: number,
): void {
  const previousCount = termState.subjects_count;
  if (
    previousCount !== null
    && previousCount >= 20
    && authoritativeSubjectCount * 4 < previousCount * 3
  ) {
    throw new Error(
      `Term finalization refused implausible destructive subject shrink for `
      + `${termState.term_id}: ${previousCount} to `
      + `${authoritativeSubjectCount}.`,
    );
  }
}

async function hashSubjectManifest(subjects: string[]): Promise<string> {
  const canonical = JSON.stringify([...subjects].sort());
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function requireReleasableTerm(
  db: D1Database,
  termId: string,
  year: number,
  term: string,
): Promise<TermState & { status: 'registrable' | 'active' }> {
  const termState = await getTermState(db, termId);
  if (
    !termState
    || termState.year !== year
    || termState.term !== term
    || (termState.status !== 'registrable' && termState.status !== 'active')
  ) {
    throw new Error(
      `Term finalization requires a discovered active or registrable ${termId}.`,
    );
  }
  return termState as TermState & { status: 'registrable' | 'active' };
}

async function readTermSubjectStates(
  db: D1Database,
  termId: string,
): Promise<SubjectSyncState[]> {
  const result = await db.prepare(`
    SELECT
      term_id,
      subject,
      last_sync,
      status,
      courses_synced,
      sections_synced,
      error
    FROM subject_sync_state
    WHERE term_id = ?
    ORDER BY subject
  `).bind(termId).all<SubjectSyncState>();
  if (!result.success) {
    throw new Error(
      `Failed to read subject sync coverage for ${termId}.`,
    );
  }
  return result.results;
}

function requireCompleteAuthoritativeCoverage(
  termId: string,
  authoritativeSubjects: string[],
  states: SubjectSyncState[],
  minimumLastSync: number,
): SubjectSyncState[] {
  const stateBySubject = new Map(states.map(state => [state.subject, state]));
  const missing = authoritativeSubjects.filter(
    subject => !stateBySubject.has(subject),
  );
  const incomplete = authoritativeSubjects.filter((subject) => {
    const state = stateBySubject.get(subject);
    return !state || !isCompleteSubjectState(state, minimumLastSync);
  });
  if (missing.length > 0 || incomplete.length > 0) {
    throw new Error(
      `Term finalization found incomplete subject coverage for ${termId}: `
      + `missing=${missing.join(',') || 'none'}; `
      + `incomplete=${incomplete.join(',') || 'none'}.`,
    );
  }
  return authoritativeSubjects.map(
    subject => stateBySubject.get(subject)!,
  );
}

function requireExactFinalCoverage(
  termId: string,
  authoritativeSubjects: string[],
  states: SubjectSyncState[],
  minimumLastSync: number,
): void {
  const authoritativeSet = new Set(authoritativeSubjects);
  const unexpected = states
    .map(state => state.subject)
    .filter(subject => !authoritativeSet.has(subject));
  requireCompleteAuthoritativeCoverage(
    termId,
    authoritativeSubjects,
    states,
    minimumLastSync,
  );
  if (states.length !== authoritativeSubjects.length || unexpected.length > 0) {
    throw new Error(
      `Term finalization found non-authoritative subject coverage for ${termId}: `
      + `${unexpected.join(',') || 'count mismatch'}.`,
    );
  }
}

function isCompleteSubjectState(
  state: SubjectSyncState,
  minimumLastSync: number,
): boolean {
  return (
    state.status === 'complete'
    && state.error === null
    && isPositiveInteger(state.last_sync)
    && state.last_sync >= minimumLastSync
    && isNonNegativeInteger(state.courses_synced)
    && isNonNegativeInteger(state.sections_synced)
  );
}

function fullSyncResult(
  year: number,
  term: string,
  states: SubjectSyncState[],
): TermSyncResult {
  const subjectResults: SubjectSyncResult[] = states.map(state => ({
    subject: state.subject,
    success: true,
    coursesCount: state.courses_synced,
    sectionsCount: state.sections_synced,
    durationMs: 0,
  }));
  return {
    termId: `${year}-${term}`,
    year,
    term,
    subjectResults,
    totalCourses: subjectResults.reduce(
      (sum, subject) => sum + subject.coursesCount,
      0,
    ),
    totalSections: subjectResults.reduce(
      (sum, subject) => sum + subject.sectionsCount,
      0,
    ),
    successfulSubjects: subjectResults.length,
    failedSubjects: 0,
    durationMs: 0,
    rateLimitHits: 0,
    pagination: {
      total: subjectResults.length,
      offset: 0,
      limit: subjectResults.length,
      hasMore: false,
    },
  };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
