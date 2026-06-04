import { describe, it, expect } from 'vitest';
import { parseQuery } from '../query-parser.js';
import { extract } from '../extractor.js';
import goldenQueries from './golden-queries.json';
import type { SearchFilters } from '@uiuc-course-search/query-types/search-planner';

interface GoldenTestCase {
  input: string;
  expected: {
    hints: Array<{ type: string; value?: string | number | boolean | Record<string, unknown> }>;
    filters: Partial<SearchFilters>;
    residual: string;
  };
  note?: string;
}

describe('golden file tests', () => {
  for (const testCase of goldenQueries as GoldenTestCase[]) {
    it(`parses "${testCase.input}"`, () => {
      // Parse power-user syntax
      const parsed = parseQuery(testCase.input);

      // Extract from residual
      const extraction = extract(parsed.clauses[0].residual);

      // Check hints
      for (const expectedHint of testCase.expected.hints) {
        const matchingHint = extraction.hints.find(h => h.type === expectedHint.type);
        expect(matchingHint, `Expected hint of type ${expectedHint.type}`).toBeDefined();

        if (expectedHint.value !== undefined) {
          expect(matchingHint!.value).toBe(expectedHint.value);
        }
      }

      // Check residual if specified
      if (testCase.expected.residual !== undefined) {
        expect(extraction.residual.trim()).toBe(testCase.expected.residual);
      }
    });
  }
});
