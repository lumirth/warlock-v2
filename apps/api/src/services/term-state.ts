import type { D1Database } from '@cloudflare/workers-types';
import { makeTermId } from '../db/ids.js';

export interface ResolvedTerm {
  termId: string;
  year: number;
  term: string;
}

type TermRow = {
  term_id: string;
  year: number;
  term: string;
};

const SEARCH_ORDER = `
  CASE status WHEN 'registrable' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
  year DESC,
  CASE term WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC
`;

export async function resolveTermContext(
  db: D1Database,
  options: {
    requestedYear?: string | null;
    requestedTerm?: string | null;
  },
): Promise<ResolvedTerm> {
  if (options.requestedYear && options.requestedTerm) {
    const year = Number.parseInt(options.requestedYear, 10);
    const term = options.requestedTerm.toLowerCase();
    const termId = makeTermId(year, term);
    return { termId, year, term };
  }

  const current = await db.prepare(`
    SELECT term_id, year, term FROM term_state
    WHERE status IN ('registrable', 'active') ORDER BY ${SEARCH_ORDER} LIMIT 1
  `).first<TermRow>();
  if (!current) throw new Error('no active catalog term');
  return { termId: current.term_id, year: current.year, term: current.term };
}
