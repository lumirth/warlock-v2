import { describe, expect, it } from 'vitest';
import {
  courseRequirementCodes,
  genedDtoRequirementCodes,
  matchingRequirementCodes,
} from '../search-requirements.js';

describe('search requirement code model', () => {
  it('normalizes flattened course and course_gened codes into one deduped set', () => {
    expect(courseRequirementCodes({ gened: 'CS' }, ['1US', 'CS', ''])).toEqual(['US', 'CS']);
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
