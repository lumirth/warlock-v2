import type { SyncState, TermState } from '../db/index.js';

const TERM_ORDER: Record<string, number> = {
  winter: 1,
  spring: 2,
  summer: 3,
  fall: 4,
};

export const FRESHNESS_THRESHOLDS = {
  activeTermMaxAgeSeconds: 36 * 60 * 60,
  historicalTermMaxAgeSeconds: 120 * 24 * 60 * 60,
  gpaMaxAgeSeconds: 7 * 24 * 60 * 60,
  rmpMaxAgeSeconds: 14 * 24 * 60 * 60,
} as const;

export type FreshnessSummary = {
  generatedAt: number;
  currentTermId: string;
  currentTermPresent: boolean;
  activeTermIds: string[];
  upcomingTermIds: string[];
  historicalTermCount: number;
  staleTermIds: string[];
  staleSyncStateIds: string[];
  thresholds: typeof FRESHNESS_THRESHOLDS;
};

export function buildFreshnessSummary(input: {
  syncStates: SyncState[];
  termStates: TermState[];
  nowSeconds: number;
  currentYear: number;
  currentTerm: string;
}): FreshnessSummary {
  const currentTermId = `${input.currentYear}-${input.currentTerm.toLowerCase()}`;
  const activeTerms = input.termStates.filter(term => term.status === 'active');
  const historicalTerms = input.termStates.filter(term => term.status === 'historical');
  const staleTermIds = input.termStates
    .filter(term => isStaleTerm(term, input.nowSeconds))
    .map(term => term.term_id);

  return {
    generatedAt: input.nowSeconds,
    currentTermId,
    currentTermPresent: input.termStates.some(term => term.term_id === currentTermId),
    activeTermIds: activeTerms.map(term => term.term_id),
    upcomingTermIds: activeTerms
      .filter(term => compareTerm(term.year, term.term, input.currentYear, input.currentTerm) > 0)
      .map(term => term.term_id),
    historicalTermCount: historicalTerms.length,
    staleTermIds,
    staleSyncStateIds: input.syncStates
      .filter(state => isStaleSyncState(state, input.nowSeconds))
      .map(state => state.id),
    thresholds: FRESHNESS_THRESHOLDS,
  };
}

function isStaleTerm(term: TermState, nowSeconds: number): boolean {
  if (!term.last_synced) {
    return true;
  }

  const ageSeconds = nowSeconds - term.last_synced;
  const maxAgeSeconds = term.status === 'active'
    ? FRESHNESS_THRESHOLDS.activeTermMaxAgeSeconds
    : FRESHNESS_THRESHOLDS.historicalTermMaxAgeSeconds;

  return ageSeconds > maxAgeSeconds;
}

function isStaleSyncState(state: SyncState, nowSeconds: number): boolean {
  if (state.id !== 'gpa' && state.id !== 'rmp') {
    return state.last_status === 'failed';
  }

  if (!state.last_sync || state.last_status === 'failed') {
    return true;
  }

  const maxAgeSeconds = state.id === 'gpa'
    ? FRESHNESS_THRESHOLDS.gpaMaxAgeSeconds
    : FRESHNESS_THRESHOLDS.rmpMaxAgeSeconds;

  return nowSeconds - state.last_sync > maxAgeSeconds;
}

function compareTerm(year: number, term: string, currentYear: number, currentTerm: string): number {
  if (year !== currentYear) {
    return year - currentYear;
  }

  return (TERM_ORDER[term.toLowerCase()] ?? 0) - (TERM_ORDER[currentTerm.toLowerCase()] ?? 0);
}
