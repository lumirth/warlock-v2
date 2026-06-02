import { describe, expect, it, vi } from 'vitest';
import { getSearchTermSummary, resolveTermContext } from '../term-state.js';
import type { D1Database } from '@cloudflare/workers-types';

function createDb(defaultRow: unknown, requestedRow: unknown = null) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => requestedRow),
      })),
      first: vi.fn(async () => sql.includes('WHERE status IN') ? defaultRow : null),
    })),
  };
}

function createSummaryDb(rows: Array<{ term_id: string; status: string }>) {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(async () => ({ results: rows })),
    })),
  };
}

describe('resolveTermContext', () => {
  it('uses term_state as the default source when no term is requested', async () => {
    const db = createDb({ term_id: '2026-fall', year: 2026, term: 'fall', status: 'registrable' });

    const term = await resolveTermContext(db as unknown as D1Database, {
      fallbackYear: '2026',
      fallbackTerm: 'spring',
    });

    expect(term).toEqual({
      termId: '2026-fall',
      year: 2026,
      term: 'fall',
      status: 'registrable',
      source: 'term_state',
    });
  });

  it('uses env values only as a fallback', async () => {
    const db = createDb(null);

    const term = await resolveTermContext(db as unknown as D1Database, {
      fallbackYear: '2026',
      fallbackTerm: 'spring',
    });

    expect(term).toEqual({
      termId: '2026-spring',
      year: 2026,
      term: 'spring',
      status: 'fallback',
      source: 'env',
    });
  });

  it('reports every open term while keeping spring/fall as the primary terms', async () => {
    const db = createSummaryDb([
      { term_id: '2026-fall', status: 'registrable' },
      { term_id: '2026-summer', status: 'registrable' },
      { term_id: '2026-spring', status: 'active' },
      { term_id: '2026-winter', status: 'active' },
    ]);

    await expect(getSearchTermSummary(db as unknown as D1Database)).resolves.toEqual({
      registrableTermId: '2026-fall',
      registrableTermIds: ['2026-fall', '2026-summer'],
      activeTermId: '2026-spring',
      activeTermIds: ['2026-spring', '2026-winter'],
    });
  });
});
