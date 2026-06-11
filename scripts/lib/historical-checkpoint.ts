import * as fs from 'fs';
import { writeFileAtomicSync } from './atomic-file.ts';

export type HistoricalWorkItem = {
  year: number;
  term: string;
  subject: string;
};

export interface HistoricalCheckpoint {
  completedItems: string[];
  completedItemStats?: Record<string, { termId: string; courses: number; sections: number }>;
  scope?: HistoricalSyncCheckpointScope;
  sqlOutput?: HistoricalSqlOutputCheckpoint;
  lastUpdated: string;
}

export interface HistoricalSyncCheckpointScope {
  startYear: number;
  endYear: number;
  termFilter: string | null;
}

export interface HistoricalSqlOutputCheckpoint {
  path: string;
  committedBytes: number;
}

export class HistoricalSyncCheckpointStore {
  private readonly completedSet = new Set<string>();
  private readonly completedItemStats = new Map<string, { termId: string; courses: number; sections: number }>();
  private scope: HistoricalSyncCheckpointScope | undefined;
  private sqlOutput: HistoricalSqlOutputCheckpoint | undefined;

  constructor(
    private readonly checkpointPath: string,
    private readonly log: (message: string) => void,
  ) {}

  load(): void {
    this.completedSet.clear();
    this.completedItemStats.clear();
    this.scope = undefined;
    this.sqlOutput = undefined;
    if (!fs.existsSync(this.checkpointPath)) {
      return;
    }

    let data: HistoricalCheckpoint;
    try {
      data = parseHistoricalCheckpoint(JSON.parse(fs.readFileSync(this.checkpointPath, 'utf-8')));
    } catch (error) {
      throw new Error(
        `[CHECKPOINT] Refusing to continue with unreadable checkpoint ${this.checkpointPath}: ${error}`,
        { cause: error },
      );
    }

    for (const key of data.completedItems) {
      this.completedSet.add(key);
    }
    for (const [key, value] of Object.entries(data.completedItemStats ?? {})) {
      this.completedItemStats.set(key, value);
    }
    this.scope = data.scope;
    this.sqlOutput = data.sqlOutput;
    this.log(`[CHECKPOINT] Loaded ${this.completedSet.size} completed items from checkpoint`);
  }

  save(scope: HistoricalSyncCheckpointScope, sqlOutput: HistoricalSqlOutputCheckpoint): void {
    const checkpoint: HistoricalCheckpoint = {
      completedItems: Array.from(this.completedSet).sort(),
      completedItemStats: Object.fromEntries(this.completedItemStats),
      scope,
      sqlOutput,
      lastUpdated: new Date().toISOString(),
    };
    writeFileAtomicSync(this.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    this.scope = scope;
    this.sqlOutput = sqlOutput;
  }

  clear(): void {
    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
      this.log('[CHECKPOINT] Cleared checkpoint file');
    }
    this.completedSet.clear();
    this.completedItemStats.clear();
    this.scope = undefined;
    this.sqlOutput = undefined;
  }

  assertCompatible(scope: HistoricalSyncCheckpointScope, sqlPath: string): void {
    if (this.completedSet.size === 0) {
      return;
    }
    if (!this.scope || !sameScope(this.scope, scope)) {
      throw new Error(
        '[CHECKPOINT] Existing progress belongs to a different year/term selection. Re-run the original command or use --fresh.',
      );
    }
    if (!this.sqlOutput || this.sqlOutput.path !== sqlPath) {
      throw new Error(
        `[CHECKPOINT] Existing progress belongs to ${this.sqlOutput?.path ?? 'an unknown SQL artifact'}, not ${sqlPath}. Re-run with the original --sql-file or use --fresh.`,
      );
    }
  }

  getSqlOutput(): HistoricalSqlOutputCheckpoint | undefined {
    return this.sqlOutput;
  }

  markCompleted(item: HistoricalWorkItem, counts: { courses: number; sections: number; termId: string }): void {
    const key = makeItemKey(item);
    this.completedSet.add(key);
    this.completedItemStats.set(key, {
      termId: counts.termId,
      courses: counts.courses,
      sections: counts.sections,
    });
  }

  isCompleted(item: HistoricalWorkItem): boolean {
    return this.completedSet.has(makeItemKey(item));
  }

  termResultsFromCheckpoint(
    workItems: HistoricalWorkItem[],
  ): Map<string, { courses: number; sections: number; subjects: number }> {
    const currentKeys = new Set(workItems.map(makeItemKey));
    const termResults = new Map<string, { courses: number; sections: number; subjects: number }>();

    for (const [key, itemStats] of this.completedItemStats) {
      if (!currentKeys.has(key)) continue;
      const existing = termResults.get(itemStats.termId) || { courses: 0, sections: 0, subjects: 0 };
      existing.courses += itemStats.courses;
      existing.sections += itemStats.sections;
      existing.subjects += 1;
      termResults.set(itemStats.termId, existing);
    }

    return termResults;
  }

  checkpointedWithoutStats(workItems: HistoricalWorkItem[]): number {
    return workItems.filter((item) => {
      const key = makeItemKey(item);
      return this.completedSet.has(key) && !this.completedItemStats.has(key);
    }).length;
  }
}

function makeItemKey(item: HistoricalWorkItem): string {
  return `${item.year}-${item.term}-${item.subject}`;
}

function parseHistoricalCheckpoint(value: unknown): HistoricalCheckpoint {
  if (!isRecord(value)) {
    throw new Error('checkpoint must be an object');
  }
  if (!Array.isArray(value.completedItems) || !value.completedItems.every((item) => typeof item === 'string')) {
    throw new Error('completedItems must be an array of strings');
  }
  if (typeof value.lastUpdated !== 'string') {
    throw new Error('lastUpdated must be a string');
  }

  let completedItemStats: HistoricalCheckpoint['completedItemStats'];
  if (value.completedItemStats !== undefined) {
    if (!isRecord(value.completedItemStats)) {
      throw new Error('completedItemStats must be an object');
    }
    completedItemStats = {};
    for (const [key, item] of Object.entries(value.completedItemStats)) {
      if (
        !isRecord(item)
        || typeof item.termId !== 'string'
        || !isNonNegativeInteger(item.courses)
        || !isNonNegativeInteger(item.sections)
      ) {
        throw new Error(`completedItemStats.${key} is invalid`);
      }
      completedItemStats[key] = {
        termId: item.termId,
        courses: item.courses,
        sections: item.sections,
      };
    }
  }

  let sqlOutput: HistoricalSqlOutputCheckpoint | undefined;
  if (value.sqlOutput !== undefined) {
    if (
      !isRecord(value.sqlOutput)
      || typeof value.sqlOutput.path !== 'string'
      || !isNonNegativeInteger(value.sqlOutput.committedBytes)
    ) {
      throw new Error('sqlOutput must contain a path and non-negative committedBytes');
    }
    sqlOutput = {
      path: value.sqlOutput.path,
      committedBytes: value.sqlOutput.committedBytes,
    };
  }

  let scope: HistoricalSyncCheckpointScope | undefined;
  if (value.scope !== undefined) {
    if (
      !isRecord(value.scope)
      || !isNonNegativeInteger(value.scope.startYear)
      || !isNonNegativeInteger(value.scope.endYear)
      || (value.scope.termFilter !== null && typeof value.scope.termFilter !== 'string')
    ) {
      throw new Error('scope must contain valid startYear, endYear, and termFilter values');
    }
    scope = {
      startYear: value.scope.startYear,
      endYear: value.scope.endYear,
      termFilter: value.scope.termFilter,
    };
  }

  return {
    completedItems: value.completedItems,
    completedItemStats,
    scope,
    sqlOutput,
    lastUpdated: value.lastUpdated,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function sameScope(
  left: HistoricalSyncCheckpointScope,
  right: HistoricalSyncCheckpointScope,
): boolean {
  return (
    left.startYear === right.startYear
    && left.endYear === right.endYear
    && left.termFilter === right.termFilter
  );
}
