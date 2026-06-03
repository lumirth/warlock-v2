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
        term({ term_id: '2026-winter', year: 2026, term: 'winter', status: 'registrable' }),
        term({ term_id: '2026-spring', year: 2026, term: 'spring', status: 'registrable' }),
        term({ term_id: '2026-summer', year: 2026, term: 'summer', status: 'registrable' }),
        term({ term_id: '2026-fall', year: 2026, term: 'fall', status: 'active' }),
        term({ term_id: '2024-fall', year: 2024, term: 'fall', status: 'historical', last_synced: null }),
      ],
    });

    expect(summary.currentTermPresent).toBe(true);
    expect(summary.currentTermId).toBe('2026-spring');
    expect(summary.configuredCurrentTermId).toBe('2026-spring');
    expect(summary.registrableTermIds).toEqual(['2026-spring', '2026-summer', '2026-winter']);
    expect(summary.activeTermIds).toEqual(['2026-fall']);
    expect(summary.upcomingTermIds).toEqual(['2026-summer', '2026-fall']);
    expect(summary.historicalTermCount).toBe(1);
    expect(summary.staleTermIds).toEqual(['2024-fall']);
    expect(summary.staleSyncStateIds).toEqual(['gpa', 'course-sync:2026-spring:CS']);
  });

  it('uses the newest registrable fall or spring term as current even when env fallback is stale', () => {
    const summary = buildFreshnessSummary({
      nowSeconds,
      currentYear: 2026,
      currentTerm: 'spring',
      syncStates: [
        sync({ id: 'gpa' }),
        sync({ id: 'rmp' }),
      ],
      termStates: [
        term({ term_id: '2026-spring', year: 2026, term: 'spring', status: 'historical' }),
        term({ term_id: '2026-summer', year: 2026, term: 'summer', status: 'registrable' }),
        term({ term_id: '2026-fall', year: 2026, term: 'fall', status: 'registrable' }),
        term({ term_id: '2026-winter', year: 2026, term: 'winter', status: 'historical' }),
      ],
    });

    expect(summary.configuredCurrentTermId).toBe('2026-spring');
    expect(summary.currentTermId).toBe('2026-fall');
    expect(summary.currentTermPresent).toBe(true);
    expect(summary.registrableTermIds).toEqual(['2026-fall', '2026-summer']);
    expect(summary.upcomingTermIds).toEqual([]);
  });

  it('does not let an older regular semester outrank a newer open winter or summer term', () => {
    const summary = buildFreshnessSummary({
      nowSeconds,
      currentYear: 2026,
      currentTerm: 'fall',
      syncStates: [
        sync({ id: 'gpa' }),
        sync({ id: 'rmp' }),
      ],
      termStates: [
        term({ term_id: '2026-fall', year: 2026, term: 'fall', status: 'registrable' }),
        term({ term_id: '2027-winter', year: 2027, term: 'winter', status: 'registrable' }),
        term({ term_id: '2027-summer', year: 2027, term: 'summer', status: 'active' }),
        term({ term_id: '2026-spring', year: 2026, term: 'spring', status: 'active' }),
      ],
    });

    expect(summary.currentTermId).toBe('2027-winter');
    expect(summary.registrableTermIds).toEqual(['2027-winter', '2026-fall']);
    expect(summary.activeTermIds).toEqual(['2027-summer', '2026-spring']);
  });

  it('applies freshness thresholds from last sync ages instead of wall-clock term names', () => {
    const summary = buildFreshnessSummary({
      nowSeconds,
      currentYear: 2030,
      currentTerm: 'fall',
      syncStates: [
        sync({ id: 'gpa', last_sync: nowSeconds - FRESHNESS_THRESHOLDS.gpaMaxAgeSeconds }),
        sync({ id: 'rmp', last_sync: nowSeconds - FRESHNESS_THRESHOLDS.rmpMaxAgeSeconds - 1 }),
      ],
      termStates: [
        term({
          term_id: '2030-fall',
          year: 2030,
          term: 'fall',
          status: 'active',
          last_synced: nowSeconds - FRESHNESS_THRESHOLDS.activeTermMaxAgeSeconds,
        }),
        term({
          term_id: '2030-summer',
          year: 2030,
          term: 'summer',
          status: 'active',
          last_synced: nowSeconds - FRESHNESS_THRESHOLDS.activeTermMaxAgeSeconds - 1,
        }),
        term({
          term_id: '2029-fall',
          year: 2029,
          term: 'fall',
          status: 'historical',
          last_synced: nowSeconds - FRESHNESS_THRESHOLDS.historicalTermMaxAgeSeconds,
        }),
        term({
          term_id: '2029-spring',
          year: 2029,
          term: 'spring',
          status: 'historical',
          last_synced: nowSeconds - FRESHNESS_THRESHOLDS.historicalTermMaxAgeSeconds - 1,
        }),
      ],
    });

    expect(summary.currentTermId).toBe('2030-fall');
    expect(summary.staleTermIds).toEqual(['2030-summer', '2029-spring']);
    expect(summary.staleSyncStateIds).toEqual(['rmp']);
  });
});
