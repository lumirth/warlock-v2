import { statSync, truncateSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HistoricalSqlOutputCheckpoint } from './historical-checkpoint.ts';

export type SqlOutputPlan = {
  enabled: boolean;
  flags: 'w' | 'a';
  writeHeader: boolean;
  mode: 'dry-run' | 'fresh' | 'new' | 'resume';
};

export function chooseSqlOutputPlan(options: {
  dryRun: boolean;
  fresh: boolean;
  skippedCount: number;
  sqlFileExists: boolean;
  sqlFileHasCommit: boolean;
}): SqlOutputPlan {
  if (options.dryRun) {
    return { enabled: false, flags: 'w', writeHeader: false, mode: 'dry-run' };
  }

  if (options.fresh || options.skippedCount === 0) {
    return {
      enabled: true,
      flags: 'w',
      writeHeader: true,
      mode: options.fresh ? 'fresh' : 'new',
    };
  }

  if (!options.sqlFileExists) {
    throw new Error('Checkpointed items exist, but the SQL file is missing. Re-run with --fresh or restore the original SQL file before resuming.');
  }

  if (options.sqlFileHasCommit) {
    throw new Error('Checkpointed items exist, but the SQL file already contains COMMIT. Use a new --sql-file with --fresh for another generated artifact.');
  }

  return { enabled: true, flags: 'a', writeHeader: false, mode: 'resume' };
}

export function sqlFileHasCommit(contents: string): boolean {
  return /(?:^|\n)COMMIT;\s*$/i.test(contents.trimEnd());
}

export function reconcileSqlOutputWithCheckpoint(
  sqlPath: string,
  checkpoint: HistoricalSqlOutputCheckpoint | undefined,
): void {
  if (!checkpoint) {
    throw new Error(
      'Checkpointed items exist, but the checkpoint does not record the SQL artifact position. Re-run with --fresh or restore a checkpoint created by the current script.',
    );
  }

  const resolvedSqlPath = resolve(sqlPath);
  if (resolve(checkpoint.path) !== resolvedSqlPath) {
    throw new Error(
      `Checkpoint belongs to ${checkpoint.path}, not ${resolvedSqlPath}. Re-run with the original --sql-file or use --fresh.`,
    );
  }

  const currentBytes = statSync(resolvedSqlPath).size;
  if (currentBytes < checkpoint.committedBytes) {
    throw new Error(
      `SQL artifact is ${currentBytes} bytes, shorter than the checkpointed ${checkpoint.committedBytes} bytes. Restore the original artifact or use --fresh.`,
    );
  }
  if (currentBytes > checkpoint.committedBytes) {
    truncateSync(resolvedSqlPath, checkpoint.committedBytes);
  }
}
