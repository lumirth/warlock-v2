import { describe, expect, it } from 'vitest';
import {
  genedDtoRequirementCodes,
  matchingRequirementCodes,
  structuredRequirementCodes,
} from '../search-requirements.js';

describe('search requirement code model', () => {
  it('normalizes structured requirement codes into one deduped set', () => {
    expect(structuredRequirementCodes(['1US', 'CS', ''])).toEqual(['US', 'CS']);
  });

  it('extracts category and sub-attribute codes from GenEd DTOs', () => {
    expect(
      genedDtoRequirementCodes([
        {
          categoryId: 'QR',
          categoryName: 'Quantitative Reasoning',
          attributeCode: '1QR2',
          attributeName: 'Quantitative Reasoning II',
        },
      ]),
    ).toEqual(['QR', 'QR2']);
  });

  it('matches requested filters after canonicalization', () => {
    expect(matchingRequirementCodes(['CS', '1US'], ['US'])).toEqual(['US']);
  });
});
