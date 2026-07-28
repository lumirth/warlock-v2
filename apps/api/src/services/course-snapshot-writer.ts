import type { D1Database } from '@cloudflare/workers-types';
import type { SubjectSnapshot } from '../transforms/course.js';
import {
  subjectSnapshotPersistencePlan,
} from './snapshot-persistence-operations.js';
import { prepareSnapshotOperation } from './snapshot-persistence-sql.js';
import { assertPublishableSubjectSnapshot } from './validation.js';

const DEFAULT_D1_WRITE_BATCH_SIZE = 100;
const PUBLICATION_FENCE_STATEMENT_COUNT = 3;

type SubjectSnapshotWriteResult = {
  coursesCount: number;
  sectionsCount: number;
};

export type SubjectSnapshotPublicationFence = {
  termId: string;
  subject: string;
  ownerToken: string;
};

export async function writeSubjectSnapshotToD1(
  db: D1Database,
  snapshot: SubjectSnapshot,
  options: {
    batchSize?: number;
    publicationFence?: SubjectSnapshotPublicationFence;
  } = {}
): Promise<SubjectSnapshotWriteResult> {
  const batchSize = options.batchSize ?? DEFAULT_D1_WRITE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Snapshot write batch size must be a positive integer');
  }
  if (options.publicationFence && batchSize <= PUBLICATION_FENCE_STATEMENT_COUNT) {
    throw new Error(
      `Fenced snapshot write batch size must exceed ${PUBLICATION_FENCE_STATEMENT_COUNT}`
    );
  }

  assertPublishableSubjectSnapshot(snapshot);
  const plan = subjectSnapshotPersistencePlan(snapshot);
  const writeStatements = plan.writeOperations.map(operation => prepareSnapshotOperation(db, operation));
  const finalizeStatements = plan.finalizeOperations.map(operation => prepareSnapshotOperation(db, operation));
  const payloadBatchSize = options.publicationFence
    ? batchSize - PUBLICATION_FENCE_STATEMENT_COUNT
    : batchSize;

  // D1 batch() is transactional. Keep the common/small subject case in one
  // atomic publication. Large subjects exceed the bounded batch size, so all
  // non-destructive upserts finish first and destructive cleanup remains one
  // final transaction. Every transaction is independently ownership-fenced:
  // a takeover between large-subject batches can leave already-committed
  // upserts, but it cannot let the stale owner continue or prune current data.
  if (writeStatements.length + finalizeStatements.length <= payloadBatchSize) {
    await executeD1Transaction(
      db,
      [...writeStatements, ...finalizeStatements],
      options.publicationFence
    );
  } else {
    await executeD1WriteBatches(
      db,
      writeStatements,
      payloadBatchSize,
      options.publicationFence
    );
    await executeD1Transaction(db, finalizeStatements, options.publicationFence);
  }

  return {
    coursesCount: plan.coursesCount,
    sectionsCount: plan.sectionsCount,
  };
}

async function executeD1WriteBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
  batchSize: number,
  publicationFence?: SubjectSnapshotPublicationFence
): Promise<void> {
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    if (chunk.length > 0) {
      await executeD1Transaction(db, chunk, publicationFence);
    }
  }
}

async function executeD1Transaction(
  db: D1Database,
  statements: D1PreparedStatement[],
  publicationFence?: SubjectSnapshotPublicationFence
): Promise<void> {
  if (statements.length === 0) return;
  if (!publicationFence) {
    await db.batch(statements);
    return;
  }

  const fenceParams = [
    publicationFence.termId,
    publicationFence.subject,
    publicationFence.ownerToken,
  ] as const;
  const openFence = db.prepare(`
    INSERT INTO subject_sync_publication_fences (
      term_id, subject, owner_token
    ) VALUES (?, ?, ?)
  `).bind(...fenceParams);
  const renewLease = db.prepare(`
    UPDATE subject_sync_state
    SET last_sync = unixepoch()
    WHERE term_id = ? AND subject = ? AND owner_token = ? AND status = 'running'
  `).bind(...fenceParams);
  const closeFence = db.prepare(`
    DELETE FROM subject_sync_publication_fences
    WHERE term_id = ? AND subject = ? AND owner_token = ?
  `).bind(...fenceParams);

  await db.batch([openFence, renewLease, ...statements, closeFence]);
}
