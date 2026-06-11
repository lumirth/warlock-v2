import { readFile } from 'node:fs/promises';
import { searchTermRank } from '@uiuc-course-search/query-types';
import { asRecord, type JsonRecord } from './json-shape.ts';
import {
  normalizeTerm,
  termId,
  type Term,
} from './term-model.ts';
import { endpoint } from './script-args.ts';

export type TermMaintenanceFetcher = (request: Request) => Promise<Response>;

export type AvailableTerm = {
  year: number;
  term: Term;
  term_id: string;
};

export async function discoverAvailableTerms(
  args: { fromYear: number; toYear: number; frontendBase: string },
  fetcher: TermMaintenanceFetcher = request => fetch(request),
): Promise<{ terms: AvailableTerm[]; warnings: string[] }> {
  const terms: AvailableTerm[] = [];
  const warnings: string[] = [];

  for (let year = args.fromYear; year <= args.toYear; year += 1) {
    const url = endpoint(args.frontendBase, `ajax/search/termlist/${year}`);
    const response = await fetcher(new Request(url));
    if (!response.ok) {
      warnings.push(`term list ${year} failed with HTTP ${response.status}`);
      continue;
    }

    const body = await response.json().catch(() => null) as unknown;
    const record = asRecord(body);
    if (!record) {
      warnings.push(`term list ${year} returned a non-object response`);
      continue;
    }

    for (const value of Object.values(record)) {
      const term = normalizeTerm(value);
      if (term) terms.push({ year, term, term_id: termId(year, term) });
    }
  }

  terms.sort((left, right) =>
    left.year - right.year || searchTermRank(left.term) - searchTermRank(right.term)
  );
  return { terms, warnings };
}

export async function loadOptionalJsonRecord(
  input: string | undefined,
  errorMessage: string,
): Promise<{ source: string | null; value: JsonRecord | null }> {
  if (!input) return { source: null, value: null };

  const body = await readFile(input, 'utf8');
  const parsed = JSON.parse(body) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new Error(errorMessage);
  }
  return { source: input, value: record };
}
