import type { D1Database } from '@cloudflare/workers-types';
import { errorFields, logger } from '../observability/logger.js';
import { makeTermId } from '../db/ids.js';
import { upsertTermState } from '../db/term-state-repository.js';
import type { TermStateStatus } from '../db/types.js';
import { getUpstreamBackoff } from './upstream-backoff.js';
import { browserFetch } from '../http/browser-fetch.js';
import { parseEnrollmentStatusesXml, parseSubjectsXml } from '../cisapi/parser.js';

const DEFAULT_FROM_YEAR = 2004;
const TERM_ORDER: Record<string, number> = {
  winter: 1,
  spring: 2,
  summer: 3,
  fall: 4,
};
const DEFAULT_CLASSIFICATION_SUBJECTS = [
  'CS',
  'MATH',
  'PHIL',
  'ENGL',
  'ECON',
  'CHEM',
  'PHYS',
  'BADM',
  'PSYC',
  'STAT',
] as const;
const REGISTRABLE_STATUS_PATTERN = /\b(open|crosslistopen|wait\s*list)\b/i;

export interface TermDiscoveryConfig {
  frontendBase: string;
  cisapiBase: string;
  fromYear?: number;
  toYear?: number;
  now?: Date;
  maxClassificationSubjects?: number;
}

export interface DiscoveredTerm {
  year: number;
  term: string;
  termId: string;
}

export interface TermClassification {
  term: DiscoveredTerm;
  status: TermStateStatus;
  sampleEnrollmentStatuses: string[];
  sampledSubjects: string[];
}

/**
 * Fetches valid terms for a given year from the frontend AJAX endpoint
 */
export async function discoverTermsForYear(
  config: TermDiscoveryConfig,
  year: number
): Promise<DiscoveredTerm[]> {
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.frontendBase}/ajax/search/termlist/${year}`;
  const response = await browserFetch(url);

  if (!response.ok) {
    if (upstreamBackoff.isRateLimited(response.status)) {
      upstreamBackoff.recordFailure(`termlist ${year}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch termlist for ${year}: ${response.status}`);
  }

  upstreamBackoff.recordSuccess();

  const data = await response.json() as Record<string, string>;
  // Response format: {"Winter":"winter","Spring":"spring",...}

  return Object.values(data).map(term => ({
    year,
    term,
    termId: makeTermId(year, term)
  }));
}

/**
 * Discovers every Course Explorer term in the supported corpus window.
 */
export async function discoverAllTerms(
  config: TermDiscoveryConfig
): Promise<DiscoveredTerm[]> {
  const currentYear = (config.now ?? new Date()).getFullYear();
  const fromYear = config.fromYear ?? DEFAULT_FROM_YEAR;
  const toYear = config.toYear ?? currentYear + 1;

  const allTerms: DiscoveredTerm[] = [];

  for (let year = fromYear; year <= toYear; year += 1) {
    try {
      const terms = await discoverTermsForYear(config, year);
      allTerms.push(...terms);
    } catch (error) {
      logger.error('termDiscovery.discoverYear.failed', { year, ...errorFields(error) });
    }
  }

  return allTerms.sort((left, right) => {
    if (left.year !== right.year) return left.year - right.year;
    return (TERM_ORDER[left.term] ?? 0) - (TERM_ORDER[right.term] ?? 0);
  });
}

/**
 * Classifies a term by sampling section enrollmentStatus values from several
 * subjects. Any open-like section makes the whole term registrable.
 */
export async function classifyTerm(
  config: TermDiscoveryConfig,
  term: DiscoveredTerm
): Promise<TermClassification> {
  const subjects = await getClassificationSubjects(config, term);
  const maxSubjects = config.maxClassificationSubjects ?? DEFAULT_CLASSIFICATION_SUBJECTS.length;
  const sampledSubjects = subjects.slice(0, maxSubjects);
  const statuses: string[] = [];

  for (const subject of sampledSubjects) {
    statuses.push(...await readEnrollmentStatuses(config, term, subject));
    const status = classifyEnrollmentStatuses(statuses);
    if (status === 'registrable') {
      return {
        term,
        status,
        sampleEnrollmentStatuses: [...new Set(statuses)].slice(0, 10),
        sampledSubjects,
      };
    }
  }

  return {
    term,
    status: classifyEnrollmentStatuses(statuses),
    sampleEnrollmentStatuses: [...new Set(statuses)].slice(0, 10),
    sampledSubjects,
  };
}

async function getClassificationSubjects(
  config: TermDiscoveryConfig,
  term: DiscoveredTerm
): Promise<string[]> {
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${term.year}/${term.term}.xml`;
  const response = await browserFetch(url);
  if (!response.ok) {
    if (upstreamBackoff.isRateLimited(response.status)) {
      upstreamBackoff.recordFailure(`subjects ${term.termId}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch subjects for ${term.termId}: ${response.status}`);
  }

  upstreamBackoff.recordSuccess();

  const xml = await response.text();
  const subjects = parseSubjectsXml(xml).map(subject => subject.id);
  const subjectSet = new Set(subjects);
  return [
    ...DEFAULT_CLASSIFICATION_SUBJECTS.filter(subject => subjectSet.has(subject)),
    ...subjects.filter(subject => !(DEFAULT_CLASSIFICATION_SUBJECTS as readonly string[]).includes(subject)),
  ];
}

async function readEnrollmentStatuses(
  config: TermDiscoveryConfig,
  term: DiscoveredTerm,
  sampleSubject: string
): Promise<string[]> {
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${term.year}/${term.term}/${sampleSubject}.xml?mode=cascade`;
  const response = await browserFetch(url);

  if (!response.ok) {
    if (upstreamBackoff.isRateLimited(response.status)) {
      upstreamBackoff.recordFailure(`classify ${term.termId}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch ${sampleSubject} for ${term.termId}: ${response.status}`);
  }

  upstreamBackoff.recordSuccess();

  const xml = await response.text();
  return parseEnrollmentStatusesXml(xml);
}

function classifyEnrollmentStatuses(statuses: string[]): TermStateStatus {
  if (statuses.some(status => REGISTRABLE_STATUS_PATTERN.test(status))) {
    return 'registrable';
  }
  if (statuses.some(status => status.trim().toUpperCase() !== 'UNKNOWN')) {
    return 'active';
  }
  return 'historical';
}

function isDefinitelyPast(term: DiscoveredTerm, now: Date): boolean {
  const currentYear = now.getFullYear();
  if (term.year < currentYear) return true;
  if (term.year > currentYear) return false;

  const month = now.getMonth() + 1;
  const currentTerm = month <= 1
    ? 'winter'
    : month <= 5
      ? 'spring'
      : month <= 8
        ? 'summer'
        : 'fall';
  return (TERM_ORDER[term.term] ?? 0) < (TERM_ORDER[currentTerm] ?? 0);
}

/**
 * Full term discovery and classification workflow
 */
export async function discoverAndClassifyTerms(
  db: D1Database,
  config: TermDiscoveryConfig
): Promise<TermClassification[]> {
  const terms = await discoverAllTerms(config);
  const classifications: TermClassification[] = [];
  const now = config.now ?? new Date();

  for (const term of terms) {
    try {
      const classification = isDefinitelyPast(term, now)
        ? {
            term,
            status: 'historical' as const,
            sampleEnrollmentStatuses: ['assumed historical by term chronology'],
            sampledSubjects: [],
          }
        : await classifyTerm(config, term);
      classifications.push(classification);

      // Update term_state in database
      await upsertTermState(db, {
        term_id: term.termId,
        year: term.year,
        term: term.term,
        status: classification.status,
        last_checked: Math.floor(Date.now() / 1000),
        last_synced: null,
        subjects_count: null,
        courses_count: null,
        sections_count: null,
        sync_errors: null,
      });
    } catch (error) {
      logger.error('termDiscovery.classifyTerm.failed', { termId: term.termId, ...errorFields(error) });
    }
  }

  return classifications;
}
