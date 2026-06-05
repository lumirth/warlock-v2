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
