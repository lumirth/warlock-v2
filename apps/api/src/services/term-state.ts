import type { D1Database } from '@cloudflare/workers-types';
import { makeTermId } from '../db/ids.js';
import { getTermState } from '../db/term-state-repository.js';
import type { TermStateStatus } from '../db/types.js';

export type TermStatus = TermStateStatus | 'requested' | 'fallback';

export interface ResolvedTerm {
  termId: string;
  year: number;
  term: string;
  status: TermStatus;
  source: 'query' | 'term_state' | 'env';
}

type TermStateRow = {
  term_id: string;
  year: number;
  term: string;
  status: TermStateStatus;
};

export async function getCurrentTermStates(db: D1Database): Promise<TermStateRow[]> {
  const result = await db.prepare(`
    SELECT term_id, year, term, status
    FROM term_state
    WHERE status IN ('active', 'registrable')
  `).all<TermStateRow>();
  return result.results;
}

export async function resolveTermContext(
  db: D1Database,
  options: {
    requestedYear?: string | null;
    requestedTerm?: string | null;
    fallbackYear: string;
    fallbackTerm: string;
  }
): Promise<ResolvedTerm> {
  if (options.requestedYear && options.requestedTerm) {
    const year = parseInt(options.requestedYear, 10);
    const term = options.requestedTerm.toLowerCase();
    const termId = makeTermId(year, term);
    const row = await getTermState(db, termId);
    return {
      termId,
      year,
      term,
      status: row?.status ?? 'requested',
      source: 'query',
    };
  }

  const defaultTerm = await db.prepare(`
    SELECT term_id, year, term, status
    FROM term_state
    WHERE status IN ('registrable', 'active')
    ORDER BY
      CASE status WHEN 'registrable' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      year DESC,
      CASE term WHEN 'fall' THEN 0 WHEN 'spring' THEN 0 WHEN 'summer' THEN 1 WHEN 'winter' THEN 1 ELSE 2 END,
      CASE term WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC
    LIMIT 1
  `).first<TermStateRow>();

  if (defaultTerm) {
    return {
      termId: defaultTerm.term_id,
      year: defaultTerm.year,
      term: defaultTerm.term,
      status: defaultTerm.status,
      source: 'term_state',
    };
  }

  const fallbackYear = parseInt(options.fallbackYear, 10);
  const fallbackTerm = options.fallbackTerm.toLowerCase();
  return {
    termId: makeTermId(fallbackYear, fallbackTerm),
    year: fallbackYear,
    term: fallbackTerm,
    status: 'fallback',
    source: 'env',
  };
}

export async function getSearchTermSummary(db: D1Database): Promise<{
  activeTermId: string | null;
  registrableTermId: string | null;
  activeTermIds: string[];
  registrableTermIds: string[];
}> {
  const result = await db.prepare(`
    SELECT term_id, status
    FROM term_state
    WHERE status IN ('active', 'registrable')
    ORDER BY
      CASE status WHEN 'registrable' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      year DESC,
      CASE term WHEN 'fall' THEN 0 WHEN 'spring' THEN 0 WHEN 'summer' THEN 1 WHEN 'winter' THEN 1 ELSE 2 END,
      CASE term WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC
  `).all<{ term_id: string; status: string }>();
  const activeTermIds = result.results
    .filter(row => row.status === 'active')
    .map(row => row.term_id);
  const registrableTermIds = result.results
    .filter(row => row.status === 'registrable')
    .map(row => row.term_id);

  return {
    activeTermId: activeTermIds[0] ?? null,
    registrableTermId: registrableTermIds[0] ?? null,
    activeTermIds,
    registrableTermIds,
  };
}
