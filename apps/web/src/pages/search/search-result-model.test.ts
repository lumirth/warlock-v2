import { describe, expect, it } from 'vitest'
import type { CourseSummaryDto } from '@uiuc-course-search/query-types'
import { courseRequirementLabels } from './search-result-model'

describe('courseRequirementLabels', () => {
  it('uses canonical short GenEd codes for dense search result cards', () => {
    const course = {
      requirements: [
        {
          categoryId: 'CS',
          categoryName: 'Cultural Studies',
          attributeCode: '1US',
          attributeName: 'US Minority Cultures',
        },
        {
          categoryId: 'CMP',
          categoryName: 'Composition I',
          attributeCode: null,
          attributeName: null,
        },
        {
          categoryId: 'SBS',
          categoryName: 'Social & Behavioral Sciences',
          attributeCode: 'SS',
          attributeName: 'Social Sciences',
        },
      ],
    } as CourseSummaryDto

    expect(courseRequirementLabels(course)).toEqual(['CS:US', 'COMP1', 'SBS:SS'])
  })
})
