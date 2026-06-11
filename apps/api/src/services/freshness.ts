import { searchTermRank } from '@uiuc-course-search/query-types';
import type { SubjectSyncState, SyncState, TermState } from '../db/types.js';

export const FRESHNESS_THRESHOLDS = {
  activeTermMaxAgeSeconds: 36 * 60 * 60,
  historicalTermMaxAgeSeconds: 120 * 24 * 60 * 60,
  gpaMaxAgeSeconds: 7 * 24 * 60 * 60,
  rmpMaxAgeSeconds: 14 * 24 * 60 * 60,
} as const;

type FreshnessSummary = {
  generatedAt: number;
  currentTermId: string;
  currentTermPresent: boolean;
  configuredCurrentTermId: string;
  registrableTermIds: string[];
  activeTermIds: string[];
  upcomingTermIds: string[];
  historicalTermCount: number;
  staleTermIds: string[];
  staleSyncStateIds: string[];
  staleSubjectSyncIds: string[];
  thresholds: typeof FRESHNESS_THRESHOLDS;
};

export function buildFreshnessSummary(input: {
  syncStates: SyncState[];
  subjectSyncStates: SubjectSyncState[];
  termStates: TermState[];
  nowSeconds: number;
  currentYear: number;
  currentTerm: string;
}): FreshnessSummary {
  const configuredCurrentTermId = `${input.currentYear}-${input.currentTerm.toLowerCase()}`;
  const registrableTerms = sortTermsByRecency(input.termStates.filter(term => term.status === 'registrable'));
  const activeTerms = input.termStates.filter(term => term.status === 'active');
  const activeTermsByRecency = sortTermsByRecency(activeTerms);
  const historicalTerms = input.termStates.filter(term => term.status === 'historical');
  const selectedCurrentTerm = registrableTerms[0] ?? activeTermsByRecency[0] ?? null;
  const currentTermId = selectedCurrentTerm?.term_id ?? configuredCurrentTermId;
  const currentYear = selectedCurrentTerm?.year ?? input.currentYear;
  const currentTerm = selectedCurrentTerm?.term ?? input.currentTerm;
  const staleTermIds = input.termStates
    .filter(term => isStaleTerm(term, input.nowSeconds))
    .map(term => term.term_id);

  return {
    generatedAt: input.nowSeconds,
    currentTermId,
    configuredCurrentTermId,
    currentTermPresent: input.termStates.some(term => term.term_id === currentTermId),
    registrableTermIds: registrableTerms.map(term => term.term_id),
    activeTermIds: activeTermsByRecency.map(term => term.term_id),
    upcomingTermIds: [...registrableTerms, ...activeTermsByRecency]
      .filter(term => compareTerm(term.year, term.term, currentYear, currentTerm) > 0)
      .map(term => term.term_id),
    historicalTermCount: historicalTerms.length,
    staleTermIds,
    staleSyncStateIds: input.syncStates
      .filter(state => isStaleSyncState(state, input.nowSeconds))
      .map(state => state.id),
    staleSubjectSyncIds: input.subjectSyncStates
      .filter(state => state.status === 'failed')
      .map(state => `${state.term_id}:${state.subject}`),
    thresholds: FRESHNESS_THRESHOLDS,
  };
}

function isStaleTerm(term: TermState, nowSeconds: number): boolean {
  if (!term.last_synced) {
    return true;
  }

  const ageSeconds = nowSeconds - term.last_synced;
  const maxAgeSeconds = term.status === 'historical'
    ? FRESHNESS_THRESHOLDS.historicalTermMaxAgeSeconds
    : FRESHNESS_THRESHOLDS.activeTermMaxAgeSeconds;

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

  return searchTermRank(term) - searchTermRank(currentTerm);
}

function sortTermsByRecency<T extends { year: number; term: string }>(terms: T[]): T[] {
  return [...terms].sort((left, right) => {
    if (left.year !== right.year) {
      return right.year - left.year;
    }

    const regularTermDelta = regularTermRank(left.term) - regularTermRank(right.term);
    if (regularTermDelta !== 0) {
      return regularTermDelta;
    }

    return searchTermRank(right.term) - searchTermRank(left.term);
  });
}

function regularTermRank(term: string): number {
  return term === 'fall' || term === 'spring' ? 0 : 1;
}
