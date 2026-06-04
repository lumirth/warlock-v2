import {
  splitAdvancedSearchState,
  type AdvancedSearchStateDto,
  type SearchRequestDto,
  type SearchSort,
} from '@uiuc-course-search/query-types'
import { cleanAdvancedFilters, hasAdvancedFilterValue } from './search-filter-model'
import { SEARCH_PAGE_SIZE } from './search-options'
import { normalizeSearchSort } from './search-sort-model'
import type { SearchExecutionMode } from './search-controller-state'

type BaseSearchCommand = {
  query: string
  filters?: AdvancedSearchStateDto
  sort?: SearchSort
}

export type SearchCommand =
  | ({ type: 'submit' } & BaseSearchCommand)
  | ({ type: 'refine' } & BaseSearchCommand)
  | ({ type: 'refresh' } & BaseSearchCommand)
  | ({ type: 'append'; offset: number } & BaseSearchCommand)

export type ResolvedSearchCommand = {
  mode: SearchExecutionMode
  query: string
  filters: AdvancedSearchStateDto
  sort: SearchSort
  request: SearchRequestDto
}

export function resolveSearchCommand(
  command: SearchCommand,
  currentSort: SearchSort,
): ResolvedSearchCommand | null {
  const normalizedQuery = command.query.trim()
  const requestState = cleanAdvancedFilters(command.filters || {})
  const { filters: requestFilters, scope } =
    splitAdvancedSearchState(requestState)
  const hasRequestFilters = hasAdvancedFilterValue(requestFilters)
  if (!normalizedQuery && !hasRequestFilters) return null

  const sort = normalizeSearchSort(command.sort ?? currentSort)
  const mode = executionModeForCommand(command)
  const offset = command.type === 'append' ? command.offset : 0
  const request: SearchRequestDto = {
    query: normalizedQuery,
    filters: hasRequestFilters ? requestFilters : undefined,
    scope,
    sort,
    pagination: {
      limit: SEARCH_PAGE_SIZE,
      offset,
    },
  }

  return {
    mode,
    query: normalizedQuery,
    filters: requestState,
    sort,
    request,
  }
}

function executionModeForCommand(command: SearchCommand): SearchExecutionMode {
  switch (command.type) {
    case 'append':
      return 'append'
    case 'refresh':
      return 'refresh'
    case 'refine':
      return 'refine'
    case 'submit':
      return 'replace'
  }
}
