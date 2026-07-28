import type { TermStateStatus } from '../db/types.js';

export const MAX_SYNC_SUBJECTS_PER_REQUEST = 20;

export type SyncBatchRequest = {
  year: number;
  term: string;
  subjects: string[];
  status?: TermStateStatus;
  totalSubjects?: number;
  forceRunningLocks?: boolean;
};
