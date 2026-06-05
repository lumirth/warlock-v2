import type { D1Database } from '@cloudflare/workers-types';
import { getTermsByStatus } from '../db/term-state-repository.js';
import type { SyncState, TermState, TermStateStatus } from '../db/types.js';
import {
  readSyncStatusSnapshot,
  type EnrichmentCoverageRow,
} from '../db/sync-status-repository.js';
import { buildFreshnessSummary } from './freshness.js';

export type SyncStatusEnvironment = {
  currentYear: string;
  currentTerm: string;
};

export type SyncStatusResponse = {
  generatedAt: string;
  syncStates: SyncState[];
  termStates: TermState[];
  enrichmentCoverage: EnrichmentCoverageRow[];
  unhealthySyncStates: SyncState[];
  runningSyncStates: SyncState[];
  freshness: ReturnType<typeof buildFreshnessSummary>;
};

export async function buildSyncStatusResponse(
  db: D1Database,
  env: SyncStatusEnvironment,
): Promise<SyncStatusResponse> {
  const snapshot = await readSyncStatusSnapshot(db);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    syncStates: snapshot.syncStates,
    termStates: snapshot.termStates,
    enrichmentCoverage: snapshot.enrichmentCoverage,
    unhealthySyncStates: snapshot.syncStates.filter(state => state.last_status === 'failed'),
    runningSyncStates: snapshot.syncStates.filter(state => state.last_status === 'running'),
    freshness: buildFreshnessSummary({
      syncStates: snapshot.syncStates,
      termStates: snapshot.termStates,
      nowSeconds,
      currentYear: parseInt(env.currentYear, 10),
      currentTerm: env.currentTerm,
    }),
  };
}

export async function listTermsForAdmin(
  db: D1Database,
  status?: TermStateStatus,
): Promise<
  | { terms: TermState[] }
  | {
    registrable: TermState[];
    active: TermState[];
    historical: TermState[];
  }
> {
  if (status) {
    return { terms: await getTermsByStatus(db, status) };
  }

  const [registrable, active, historical] = await Promise.all([
    getTermsByStatus(db, 'registrable'),
    getTermsByStatus(db, 'active'),
    getTermsByStatus(db, 'historical'),
  ]);

  return { registrable, active, historical };
}
