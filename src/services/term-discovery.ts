import type { D1Database } from '@cloudflare/workers-types';
import { upsertTermState, makeTermId, type TermState } from '../db/index.js';
import { getRateLimiter } from './rate-limiter.js';

export interface TermDiscoveryConfig {
  frontendBase: string;
  cisapiBase: string;
}

export interface DiscoveredTerm {
  year: number;
  term: string;
  termId: string;
}

export interface TermClassification {
  term: DiscoveredTerm;
  status: 'active' | 'historical';
  sampleEnrollmentStatuses: string[];
}

/**
 * Fetches valid terms for a given year from the frontend AJAX endpoint
 */
export async function discoverTermsForYear(
  config: TermDiscoveryConfig,
  year: number
): Promise<DiscoveredTerm[]> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.frontendBase}/ajax/search/termlist/${year}`;
  const response = await fetch(url);

  if (!response.ok) {
    if (rateLimiter.isRateLimited(response.status)) {
      rateLimiter.recordFailure(`termlist ${year}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch termlist for ${year}: ${response.status}`);
  }

  rateLimiter.recordSuccess();

  const data = await response.json() as Record<string, string>;
  // Response format: {"Winter":"winter","Spring":"spring",...}

  return Object.values(data).map(term => ({
    year,
    term,
    termId: makeTermId(year, term)
  }));
}

/**
 * Discovers terms for current and next year
 */
export async function discoverAllTerms(
  config: TermDiscoveryConfig
): Promise<DiscoveredTerm[]> {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];

  const allTerms: DiscoveredTerm[] = [];

  for (const year of years) {
    try {
      const terms = await discoverTermsForYear(config, year);
      allTerms.push(...terms);
    } catch (error) {
      console.error(`Failed to discover terms for ${year}:`, error);
    }
  }

  return allTerms;
}

/**
 * Classifies a term as active or historical by sampling enrollmentStatus
 * from a subject cascade
 */
export async function classifyTerm(
  config: TermDiscoveryConfig,
  term: DiscoveredTerm,
  sampleSubject: string = 'CS'
): Promise<TermClassification> {
  const rateLimiter = getRateLimiter();
  await rateLimiter.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${term.year}/${term.term}/${sampleSubject}.xml?mode=cascade`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/xml' }
  });

  if (!response.ok) {
    if (rateLimiter.isRateLimited(response.status)) {
      rateLimiter.recordFailure(`classify ${term.termId}: ${response.status}`, response.status);
    }
    throw new Error(`Failed to fetch ${sampleSubject} for ${term.termId}: ${response.status}`);
  }

  rateLimiter.recordSuccess();

  const xml = await response.text();

  // Extract all enrollmentStatus values
  const statusRegex = /<enrollmentStatus>([^<]*)<\/enrollmentStatus>/g;
  const statuses: string[] = [];
  let match;
  while ((match = statusRegex.exec(xml)) !== null) {
    statuses.push(match[1]);
  }

  // If ANY status is not "UNKNOWN", term is active
  const hasRealStatus = statuses.some(s => s.toUpperCase() !== 'UNKNOWN');

  return {
    term,
    status: hasRealStatus ? 'active' : 'historical',
    sampleEnrollmentStatuses: [...new Set(statuses)].slice(0, 5) // Unique, max 5
  };
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

  for (const term of terms) {
    try {
      const classification = await classifyTerm(config, term);
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
      console.error(`Failed to classify term ${term.termId}:`, error);
    }
  }

  return classifications;
}
