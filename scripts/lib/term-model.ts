import { asRecord, numericOrNull, type JsonRecord } from './json-shape.ts';

export const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
export const STATUSES = ['registrable', 'active', 'historical'] as const;

export type Term = typeof TERMS[number];
export type TermStatus = typeof STATUSES[number];

export const TERM_ORDER: Record<Term, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  fall: 3,
};

export function termId(year: number, term: Term): string {
  return `${year}-${term}`;
}

export function isTerm(value: unknown): value is Term {
  return typeof value === 'string' && (TERMS as readonly string[]).includes(value.toLowerCase());
}

export function normalizeTerm(value: unknown): Term | null {
  return isTerm(value) ? value.toLowerCase() as Term : null;
}

export function isTermStatus(value: unknown): value is TermStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value.toLowerCase());
}

export function normalizeStatus(value: unknown): TermStatus | null {
  return isTermStatus(value) ? value.toLowerCase() as TermStatus : null;
}

export function inferCurrentTerm(date = new Date()): Term {
  const month = date.getMonth() + 1;
  if (month <= 1) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}

export function compareTerms(
  year: number,
  term: Term,
  currentYear: number,
  currentTerm: Term,
): number {
  if (year !== currentYear) return year - currentYear;
  return TERM_ORDER[term] - TERM_ORDER[currentTerm];
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
