import type { D1Database } from '@cloudflare/workers-types';
import { searchTermRank } from '@uiuc-course-search/query-types';
import { parseEnrollmentStatusesXml, parseSubjectsXml, parseTermListXml } from '../cisapi/parser.js';
import { makeTermId } from '../db/ids.js';
import type { TermStateStatus } from '../db/types.js';
import { browserFetch } from '../http/browser-fetch.js';
import { errorFields, logger } from '../observability/logger.js';

const OPEN = /\b(open|crosslistopen|wait\s*list)\b/i;
type Config = {
  cisapiBase: string;
  fromYear?: number;
  toYear?: number;
  now?: Date;
  maxClassificationSubjects?: number;
};
type DiscoveredTerm = { year: number; term: string; termId: string };
type TermClassification = {
  term: DiscoveredTerm;
  status: TermStateStatus;
  sampleEnrollmentStatuses: string[];
  sampledSubjects: string[];
};

export async function discoverAllTerms(config: Config): Promise<DiscoveredTerm[]> {
  const now = config.now ?? new Date();
  const terms: DiscoveredTerm[] = [];
  for (
    let year = config.fromYear ?? 2004;
    year <= (config.toYear ?? now.getFullYear() + 1);
    year += 1
  ) {
    const url = `${trim(config.cisapiBase)}/schedule/${year}.xml`;
    for (const term of parseTermListXml(await getXml(url), {
      requestedYear: year,
      cisapiBase: config.cisapiBase,
    })) {
      terms.push({ year: term.year, term: term.term, termId: makeTermId(term.year, term.term) });
    }
  }
  return terms.sort((left, right) =>
    left.year - right.year || searchTermRank(left.term) - searchTermRank(right.term));
}

export async function classifyTerm(config: Config, term: DiscoveredTerm): Promise<TermClassification> {
  const subjectUrl = `${trim(config.cisapiBase)}/schedule/${term.year}/${term.term}.xml`;
  const available = parseSubjectsXml(await getXml(subjectUrl)).map(subject => subject.id);
  const preferred = ['CS', 'MATH', 'ENGL'];
  const subjects = [
    ...preferred.filter(subject => available.includes(subject)),
    ...available.filter(subject => !preferred.includes(subject)),
  ].slice(0, config.maxClassificationSubjects ?? preferred.length);
  const statuses: string[] = [];
  for (const subject of subjects) {
    statuses.push(...parseEnrollmentStatusesXml(await getXml(
      `${trim(config.cisapiBase)}/schedule/${term.year}/${term.term}/${subject}.xml?mode=cascade`,
    )));
    if (statuses.some(status => OPEN.test(status))) break;
  }
  return {
    term,
    status: statuses.some(status => OPEN.test(status)) ? 'registrable' : 'active',
    sampleEnrollmentStatuses: [...new Set(statuses)].slice(0, 10),
    sampledSubjects: subjects,
  };
}

export async function discoverAndClassifyTerms(
  db: D1Database,
  config: Config,
): Promise<TermClassification[]> {
  const now = config.now ?? new Date();
  const checkedAt = Math.floor(now.getTime() / 1000);
  const classifications: TermClassification[] = [];

  for (const term of await discoverAllTerms(config)) {
    try {
      const classification: TermClassification = isPast(term, now)
        ? { term, status: 'historical', sampleEnrollmentStatuses: [], sampledSubjects: [] }
        : await classifyTerm(config, term);
      classifications.push(classification);
      await saveClassification(db, classification, checkedAt);
    } catch (error) {
      logger.error('termDiscovery.failed', { termId: term.termId, ...errorFields(error) });
    }
  }
  return classifications;
}

async function getXml(url: string): Promise<string> {
  const response = await browserFetch(url, { timeoutMs: 30_000 });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

function trim(value: string): string {
  return value.replace(/\/+$/, '');
}

function isPast(term: DiscoveredTerm, now: Date): boolean {
  if (term.year !== now.getFullYear()) return term.year < now.getFullYear();
  const month = now.getMonth() + 1;
  const current = month <= 1 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'fall';
  return searchTermRank(term.term) < searchTermRank(current);
}

async function saveClassification(
  db: D1Database,
  classification: TermClassification,
  checkedAt: number,
): Promise<void> {
  const { term, status } = classification;
  await db.prepare(`
    INSERT INTO term_state (term_id, year, term, status, last_checked)
    SELECT ?, ?, ?, ?, ?
    WHERE ? != 'historical' OR EXISTS (SELECT 1 FROM term_state WHERE term_id = ?)
    ON CONFLICT(term_id) DO UPDATE SET
      year = excluded.year, term = excluded.term, status = excluded.status,
      last_checked = excluded.last_checked
  `).bind(term.termId, term.year, term.term, status, checkedAt, status, term.termId).run();
}
