import { describe, expect, it, vi } from 'vitest';
import { resolveTermContext } from '../term-state.js';

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

describe('resolveTermContext', () => {
  it('uses term_state as the default source when no term is requested', async () => {
    const db = createDb({ term_id: '2026-fall', year: 2026, term: 'fall', status: 'registrable' });

    const term = await resolveTermContext(db as any, {
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

    const term = await resolveTermContext(db as any, {
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
});
