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

function preparedSql(db: { prepare: unknown }): string {
  const prepare = db.prepare as { mock: { calls: unknown[][] } };
  return String(prepare.mock.calls[0]?.[0] ?? '');
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

  it('orders default open-term SQL by status, year recency, then same-year regular semester preference', async () => {
    const db = createDb({ term_id: '2027-winter', year: 2027, term: 'winter', status: 'registrable' });

    await resolveTermContext(db as unknown as D1Database, {
      fallbackYear: '2026',
      fallbackTerm: 'spring',
    });

    const sql = preparedSql(db);
    expect(sql.indexOf('CASE status')).toBeLessThan(sql.indexOf('year DESC'));
    expect(sql.indexOf('year DESC')).toBeLessThan(sql.indexOf("CASE term WHEN 'fall' THEN 0"));
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

  it('orders open-term summary SQL by status, year recency, then same-year regular semester preference', async () => {
    const db = createSummaryDb([
      { term_id: '2027-winter', status: 'registrable' },
      { term_id: '2026-fall', status: 'registrable' },
    ]);

    await getSearchTermSummary(db as unknown as D1Database);

    const sql = preparedSql(db);
    expect(sql.indexOf('CASE status')).toBeLessThan(sql.indexOf('year DESC'));
    expect(sql.indexOf('year DESC')).toBeLessThan(sql.indexOf("CASE term WHEN 'fall' THEN 0"));
  });
});
