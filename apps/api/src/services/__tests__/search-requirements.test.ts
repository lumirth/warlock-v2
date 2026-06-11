import { describe, expect, it } from 'vitest';
import {
  courseRequirementDtoCodes,
  matchingRequirementCodes,
} from '../search-requirements.js';

describe('search requirement code model', () => {
  it('extracts category and sub-attribute codes from requirement DTOs', () => {
    expect(
      courseRequirementDtoCodes([
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
