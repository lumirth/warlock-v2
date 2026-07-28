import { readFile } from 'node:fs/promises';
import { parseTermListXml } from '@uiuc-course-search/course-explorer-contract';
import { searchTermRank } from '@uiuc-course-search/query-types';
import { asRecord, type JsonRecord } from './json-shape.ts';
import {
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
  args: { fromYear: number; toYear: number; cisapiBase: string },
  fetcher: TermMaintenanceFetcher = request => fetch(request),
): Promise<{ terms: AvailableTerm[]; warnings: string[] }> {
  const terms: AvailableTerm[] = [];
  const warnings: string[] = [];

  for (let year = args.fromYear; year <= args.toYear; year += 1) {
    const url = endpoint(args.cisapiBase, `schedule/${year}.xml`);
    const response = await fetcher(new Request(url));
    if (!response.ok) {
      warnings.push(`term list ${year} failed with HTTP ${response.status}`);
      continue;
    }

    const xml = await response.text();
    let parsed;
    try {
      parsed = parseTermListXml(xml, {
        requestedYear: year,
        cisapiBase: args.cisapiBase,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`term list ${year} was rejected: ${message}`);
      continue;
    }

    for (const item of parsed) {
      terms.push({
        year: item.year,
        term: item.term,
        term_id: termId(item.year, item.term),
      });
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
