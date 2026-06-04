import * as fs from 'fs';

export type HistoricalWorkItem = {
  year: number;
  term: string;
  subject: string;
};

export interface HistoricalCheckpoint {
  completedItems: string[];
  completedItemStats?: Record<string, { termId: string; courses: number; sections: number }>;
  lastUpdated: string;
}

export class HistoricalSyncCheckpointStore {
  private readonly completedSet = new Set<string>();
  private readonly completedItemStats = new Map<string, { termId: string; courses: number; sections: number }>();

  constructor(
    private readonly checkpointPath: string,
    private readonly log: (message: string) => void,
  ) {}

  load(): void {
    this.completedSet.clear();
    this.completedItemStats.clear();
    try {
      if (fs.existsSync(this.checkpointPath)) {
        const data = JSON.parse(fs.readFileSync(this.checkpointPath, 'utf-8')) as HistoricalCheckpoint;
        for (const key of data.completedItems) {
          this.completedSet.add(key);
        }
        for (const [key, value] of Object.entries(data.completedItemStats ?? {})) {
          this.completedItemStats.set(key, value);
        }
        this.log(`[CHECKPOINT] Loaded ${this.completedSet.size} completed items from checkpoint`);
      }
    } catch (err) {
      this.log(`[CHECKPOINT] Could not load checkpoint: ${err}`);
    }
  }

  save(): void {
    const checkpoint: HistoricalCheckpoint = {
      completedItems: Array.from(this.completedSet),
      completedItemStats: Object.fromEntries(this.completedItemStats),
      lastUpdated: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(this.checkpointPath, JSON.stringify(checkpoint));
    } catch (err) {
      this.log(`[CHECKPOINT] Could not save checkpoint: ${err}`);
    }
  }

  clear(): void {
    try {
      if (fs.existsSync(this.checkpointPath)) {
        fs.unlinkSync(this.checkpointPath);
        this.log('[CHECKPOINT] Cleared checkpoint file');
      }
      this.completedSet.clear();
      this.completedItemStats.clear();
    } catch (err) {
      this.log(`[CHECKPOINT] Could not clear checkpoint: ${err}`);
    }
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
