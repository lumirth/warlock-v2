import { describe, expect, it } from 'vitest'
import {
  SEARCH_LEVEL_VALUES,
  SEARCH_SORT_FIELDS,
  SEARCH_STATUS_VALUES,
  SEARCH_TERM_VALUES,
  SEARCH_TIME_VALUES,
  SEARCH_WORKLOAD_VALUES,
} from '@uiuc-course-search/query-types'
import {
  LEVEL_OPTIONS,
  SORT_FIELD_OPTIONS,
  STATUS_OPTIONS,
  TERM_OPTIONS,
  TIME_OPTIONS,
  WORKLOAD_OPTIONS,
} from './search-options'

describe('search option values', () => {
  it('derives advanced and sort option values from the public search contract', () => {
    expect(TERM_OPTIONS.map((option) => option.value)).toEqual([
      ...SEARCH_TERM_VALUES,
    ])
    expect(TIME_OPTIONS.map((option) => option.value)).toEqual([
      ...SEARCH_TIME_VALUES,
    ])
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual([
      ...SEARCH_STATUS_VALUES,
    ])
    expect(WORKLOAD_OPTIONS.map((option) => option.value)).toEqual([
      ...SEARCH_WORKLOAD_VALUES,
    ])
    expect(LEVEL_OPTIONS.map((option) => Number(option.value))).toEqual([
      ...SEARCH_LEVEL_VALUES,
    ])
    expect(SORT_FIELD_OPTIONS.map((option) => option.value)).toEqual([
      ...SEARCH_SORT_FIELDS,
    ])
  })
})
