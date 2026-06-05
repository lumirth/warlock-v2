import { describe, expect, it } from 'vitest'
import type { CourseSummaryDto, SearchChipDto } from '@uiuc-course-search/query-types'
import { courseRequirementLabels, getChipClass } from './search-result-model'

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

describe('getChipClass', () => {
  const chip = (overrides: Partial<SearchChipDto>): SearchChipDto => ({
    id: 'chip',
    type: 'subject',
    label: 'Subject CS',
    value: 'CS',
    source: 'natural_language',
    removable: true,
    editable: true,
    ...overrides,
  })

  it('uses neutral styling for removable search chips instead of unexplained action orange', () => {
    expect(getChipClass(chip({ type: 'subject' }))).not.toContain('primary')
    expect(getChipClass(chip({ type: 'instructor' }))).not.toContain('primary')
    expect(getChipClass(chip({ type: 'courseCode' }))).not.toContain('primary')
    expect(getChipClass(chip({ type: 'requirement' }))).toContain('bg-secondary')
  })
})
