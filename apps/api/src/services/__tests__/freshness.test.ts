import { describe, expect, it } from 'vitest';
import type { SyncState, TermState } from '../../db/index.js';
import { buildFreshnessSummary, FRESHNESS_THRESHOLDS } from '../freshness.js';

const nowSeconds = 1780360000;

function term(overrides: Partial<TermState>): TermState {
  return {
    term_id: '2026-spring',
    year: 2026,
    term: 'spring',
    status: 'active',
    last_checked: nowSeconds,
    last_synced: nowSeconds,
    subjects_count: 1,
    courses_count: 2,
    sections_count: 3,
    sync_errors: null,
    created_at: nowSeconds,
    updated_at: nowSeconds,
    ...overrides,
  };
}

function sync(overrides: Partial<SyncState>): SyncState {
  return {
    id: 'gpa',
    last_sync: nowSeconds,
    last_status: 'complete',
    items_synced: 1,
    cursor: 0,
    etag: null,
    ...overrides,
  };
}

describe('buildFreshnessSummary', () => {
  it('classifies current, upcoming, historical, and stale data coverage', () => {
    const summary = buildFreshnessSummary({
      nowSeconds,
      currentYear: 2026,
      currentTerm: 'spring',
      syncStates: [
        sync({ id: 'gpa', last_sync: nowSeconds - FRESHNESS_THRESHOLDS.gpaMaxAgeSeconds - 1 }),
        sync({ id: 'rmp', last_sync: nowSeconds }),
        sync({ id: 'course-sync:2026-spring:CS', last_status: 'failed' }),
      ],
      termStates: [
        term({ term_id: '2026-spring', year: 2026, term: 'spring', status: 'active' }),
        term({ term_id: '2026-fall', year: 2026, term: 'fall', status: 'active' }),
        term({ term_id: '2024-fall', year: 2024, term: 'fall', status: 'historical', last_synced: null }),
      ],
    });

    expect(summary.currentTermPresent).toBe(true);
    expect(summary.activeTermIds).toEqual(['2026-spring', '2026-fall']);
    expect(summary.upcomingTermIds).toEqual(['2026-fall']);
    expect(summary.historicalTermCount).toBe(1);
    expect(summary.staleTermIds).toEqual(['2024-fall']);
    expect(summary.staleSyncStateIds).toEqual(['gpa', 'course-sync:2026-spring:CS']);
  });
});
