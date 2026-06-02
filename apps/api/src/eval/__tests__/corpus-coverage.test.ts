import { describe, expect, it } from 'vitest';
import {
  CORPUS_COVERAGE_REQUIREMENTS,
  evaluateCorpusCoverage,
  findDuplicateQueryIds,
} from '../corpus-coverage.js';
import { GOLDEN_QUERIES } from '../golden-queries.js';

describe('query corpus coverage', () => {
  it('keeps golden query IDs unique', () => {
    expect(findDuplicateQueryIds(GOLDEN_QUERIES)).toEqual([]);
  });

  it('covers every required natural-language failure class', () => {
    const coverage = evaluateCorpusCoverage(GOLDEN_QUERIES);
    const failures = coverage.filter(result => !result.passes);

    expect(coverage.map(result => result.failureClass)).toEqual(
      CORPUS_COVERAGE_REQUIREMENTS.map(requirement => requirement.failureClass)
    );
    expect(failures).toEqual([]);
  });
});
