import type { D1Database } from '@cloudflare/workers-types';
import {
  type CourseGenEdSnapshot,
  type CourseSnapshot,
  type SubjectSnapshot
} from '../transforms/course.js';
import {
  courseGenedPersistenceOperations,
  courseSnapshotPersistenceOperations,
  escapeSqlValue,
  prepareSnapshotOperation,
  snapshotOperationsSqlStatements,
  subjectSnapshotPersistencePlan,
  subjectStalePruneOperations,
  type GenEdCleanup,
  type SnapshotPersistenceOperation,
} from './snapshot-persistence-operations.js';

const DEFAULT_D1_WRITE_BATCH_SIZE = 100;

export { escapeSqlValue, type GenEdCleanup };

export type SubjectSnapshotWriteResult = {
  coursesCount: number;
  sectionsCount: number;
  coursesForEmbedding: CourseSnapshot['course'][];
};

export async function writeSubjectSnapshotToD1(
  db: D1Database,
  snapshot: SubjectSnapshot,
  options: { batchSize?: number } = {}
): Promise<SubjectSnapshotWriteResult> {
  const plan = subjectSnapshotPersistencePlan(snapshot);
  const batchSize = options.batchSize ?? DEFAULT_D1_WRITE_BATCH_SIZE;
  await executeD1Batch(
    db,
    plan.operations.map(operation => prepareSnapshotOperation(db, operation)),
    batchSize
  );

  return {
    coursesCount: plan.coursesCount,
    sectionsCount: plan.sectionsCount,
    coursesForEmbedding: plan.coursesForEmbedding,
  };
}

async function executeD1Batch(
  db: D1Database,
  statements: D1PreparedStatement[],
  batchSize: number
): Promise<void> {
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    if (chunk.length > 0) await db.batch(chunk);
  }
}

export async function pruneStaleCourseGeneds(
  db: D1Database,
  cleanup: GenEdCleanup
): Promise<void> {
  await executeD1Operations(db, [{ kind: 'course_gened.prune_stale', cleanup }]);
}

export async function pruneStaleSubjectRows(
  db: D1Database,
  subjectId: string,
  year: number,
  term: string,
  syncTimestamp: number
): Promise<void> {
  await executeD1Operations(
    db,
    subjectStalePruneOperations(subjectId, year, term, syncTimestamp)
  );
}

export function subjectSnapshotSqlStatements(snapshot: SubjectSnapshot): string[] {
  return snapshotOperationsSqlStatements(
    subjectSnapshotPersistencePlan(snapshot).operations
  );
}

export function courseSnapshotSqlStatements(snapshot: CourseSnapshot): string[] {
  return snapshotOperationsSqlStatements(
    courseSnapshotPersistenceOperations(snapshot)
  );
}

export function termStateSqlStatements(
  termResults: Map<string, { courses: number; sections: number; subjects: number }>,
  lastSynced: number = Math.floor(Date.now() / 1000)
): string[] {
  return Array.from(termResults.entries()).map(([termId, termStats]) => {
    const [yearStr, term] = termId.split('-');
    const year = parseInt(yearStr, 10);
    return `INSERT OR REPLACE INTO term_state (term_id, year, term, status, last_checked, last_synced, subjects_count, courses_count, sections_count) VALUES (${escapeSqlValue(termId)}, ${year}, ${escapeSqlValue(term)}, 'historical', ${lastSynced}, ${lastSynced}, ${termStats.subjects}, ${termStats.courses}, ${termStats.sections});`;
  });
}

export function courseGenedSqlStatements(
  courseId: string,
  genEdCategories: CourseGenEdSnapshot[],
): string[] {
  return snapshotOperationsSqlStatements(
    courseGenedPersistenceOperations(courseId, genEdCategories)
  );
}

async function executeD1Operations(
  db: D1Database,
  operations: SnapshotPersistenceOperation[]
): Promise<void> {
  for (const operation of operations) {
    await prepareSnapshotOperation(db, operation).run();
  }
}
