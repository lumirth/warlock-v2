import type { D1Database } from '@cloudflare/workers-types';
import type { SubjectSnapshot } from '../transforms/course.js';
import {
  subjectSnapshotPersistencePlan,
} from './snapshot-persistence-operations.js';
import { prepareSnapshotOperation } from './snapshot-persistence-sql.js';

const DEFAULT_D1_WRITE_BATCH_SIZE = 100;

type SubjectSnapshotWriteResult = {
  coursesCount: number;
  sectionsCount: number;
};

export async function writeSubjectSnapshotToD1(
  db: D1Database,
  snapshot: SubjectSnapshot,
  options: { batchSize?: number } = {}
): Promise<SubjectSnapshotWriteResult> {
  const plan = subjectSnapshotPersistencePlan(snapshot);
  const batchSize = options.batchSize ?? DEFAULT_D1_WRITE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Snapshot write batch size must be a positive integer');
  }
  await executeD1WriteBatches(
    db,
    plan.writeOperations.map(operation => prepareSnapshotOperation(db, operation)),
    batchSize
  );
  await executeD1Finalization(
    db,
    plan.finalizeOperations.map(operation => prepareSnapshotOperation(db, operation))
  );

  return {
    coursesCount: plan.coursesCount,
    sectionsCount: plan.sectionsCount,
  };
}

async function executeD1WriteBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
  batchSize: number
): Promise<void> {
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    if (chunk.length > 0) await db.batch(chunk);
  }
}

async function executeD1Finalization(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  if (statements.length > 0) await db.batch(statements);
}
