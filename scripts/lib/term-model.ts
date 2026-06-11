import { asRecord, numericOrNull, type JsonRecord } from './json-shape.ts';
import {
  SEARCH_TERM_VALUES,
  TERM_STATUS_VALUES,
  searchTermRank,
  type SearchTermFilter,
  type TermStatus,
} from '@uiuc-course-search/query-types';

export type Term = SearchTermFilter;
export type { TermStatus };

export function termId(year: number, term: Term): string {
  return `${year}-${term}`;
}

export function isTerm(value: unknown): value is Term {
  return typeof value === 'string' && (SEARCH_TERM_VALUES as readonly string[]).includes(value.toLowerCase());
}

export function normalizeTerm(value: unknown): Term | null {
  return isTerm(value) ? value.toLowerCase() as Term : null;
}

export function isTermStatus(value: unknown): value is TermStatus {
  return typeof value === 'string' && (TERM_STATUS_VALUES as readonly string[]).includes(value.toLowerCase());
}

function normalizeStatus(value: unknown): TermStatus | null {
  return isTermStatus(value) ? value.toLowerCase() as TermStatus : null;
}

export function inferCurrentTerm(date = new Date()): Term {
  const month = date.getMonth() + 1;
  if (month <= 1) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}

function compareTerms(
  year: number,
  term: Term,
  currentYear: number,
  currentTerm: Term,
): number {
  if (year !== currentYear) return year - currentYear;
  return searchTermRank(term) - searchTermRank(currentTerm);
}

export function expectedTermStatus(
  storedStatus: unknown,
  year: number,
  term: Term,
  currentYear: number,
  currentTerm: Term,
): TermStatus {
  return normalizeStatus(storedStatus)
    ?? (compareTerms(year, term, currentYear, currentTerm) < 0 ? 'historical' : 'active');
}

export function parseTermStateId(row: JsonRecord): string | null {
  if (typeof row.term_id === 'string') return row.term_id;
  const year = numericOrNull(row.year);
  const term = normalizeTerm(row.term);
  return year && term ? termId(year, term) : null;
}

export function currentTermFromStatus(status: JsonRecord | null): { year: number; term: Term } | null {
  const freshness = asRecord(status?.freshness);
  const currentTermId = typeof freshness?.currentTermId === 'string'
    ? freshness.currentTermId
    : typeof freshness?.configuredCurrentTermId === 'string'
      ? freshness.configuredCurrentTermId
      : null;
  if (!currentTermId) return null;

  const match = /^(\d{4})-([a-z]+)$/i.exec(currentTermId);
  if (!match) return null;

  const term = normalizeTerm(match[2]);
  if (!term) return null;

  return { year: Number.parseInt(match[1], 10), term };
}
