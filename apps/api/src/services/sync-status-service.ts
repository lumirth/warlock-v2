import type { D1Database } from '@cloudflare/workers-types';
import type {
  SearchTermFilter,
  SearchTermOptionsDto,
  TermOptionStatus,
} from '@uiuc-course-search/query-types';
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

type PublicTermRow = {
  term_id: string;
  year: number;
  term: SearchTermFilter;
  status: TermOptionStatus;
};

type CourseTermRow = {
  year: number;
  term: SearchTermFilter;
};

const TERM_LABELS: Record<SearchTermFilter, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
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

export async function listPublicTermOptions(
  db: D1Database,
): Promise<SearchTermOptionsDto> {
  const termStateRows = await db.prepare(`
    SELECT term_id, year, term, status
    FROM term_state
    WHERE status IN ('registrable', 'active', 'historical')
    ORDER BY year DESC,
      CASE term
        WHEN 'fall' THEN 4
        WHEN 'summer' THEN 3
        WHEN 'spring' THEN 2
        WHEN 'winter' THEN 1
        ELSE 0
      END DESC
  `).all<PublicTermRow>();

  const termStateTerms = (termStateRows.results ?? []).map((row) => ({
    termId: row.term_id,
    term: row.term,
    year: row.year,
    status: row.status,
    label: `${TERM_LABELS[row.term] ?? row.term} ${row.year}`,
  }));
  const terms = termStateTerms.length > 0
    ? termStateTerms
    : await listCourseBackedTermOptions(db);
  const years = [...new Set(terms.map((term) => term.year))]
    .sort((left, right) => right - left);

  return { terms, years };
}

async function listCourseBackedTermOptions(
  db: D1Database,
): Promise<SearchTermOptionsDto['terms']> {
  const result = await db.prepare(`
    SELECT DISTINCT year, term
    FROM courses
    WHERE term IN ('winter', 'spring', 'summer', 'fall')
    ORDER BY year DESC,
      CASE term
        WHEN 'fall' THEN 4
        WHEN 'summer' THEN 3
        WHEN 'spring' THEN 2
        WHEN 'winter' THEN 1
        ELSE 0
      END DESC
  `).all<CourseTermRow>();

  return (result.results ?? []).map((row) => ({
    termId: `${row.year}-${row.term}`,
    term: row.term,
    year: row.year,
    status: 'active',
    label: `${TERM_LABELS[row.term] ?? row.term} ${row.year}`,
  }));
}
