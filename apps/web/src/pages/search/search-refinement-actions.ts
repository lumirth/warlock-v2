import type {
  AdvancedSearchStateDto,
  SearchRequestDto,
} from '@uiuc-course-search/query-types'
import {
  cleanAdvancedFilters,
  advancedStateFromRequest,
  hasSearchableAdvancedFilterValue,
} from './search-filter-model'

export type SearchRefinementPlan =
  | {
      kind: 'search'
      request: SearchRequestDto
      draft?: AdvancedSearchStateDto
    }
  | {
      kind: 'clear'
      draft?: AdvancedSearchStateDto
    }

export function planSearchRequest(nextRequest: SearchRequestDto): SearchRefinementPlan {
  const nextFilters = advancedStateFromRequest(nextRequest)
  const nextQuery = nextRequest.query.trim()
  const draft = cleanAdvancedFilters(nextFilters)

  if (!nextQuery && !hasSearchableAdvancedFilterValue(draft)) {
    return { kind: 'clear', draft }
  }

  return {
    kind: 'search',
    draft,
    request: nextRequest,
  }
}
