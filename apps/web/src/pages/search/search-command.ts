import {
  coerceSearchRequestDto,
  searchRequestHasFilters,
  splitAdvancedSearchState,
  type AdvancedSearchStateDto,
  type SearchRequestDto,
  type SearchSort,
} from '@uiuc-course-search/query-types'
import {
  advancedStateFromRequest,
  cleanAdvancedFilters,
  hasAdvancedFilterValue,
} from './search-filter-model'
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
  | {
      type: 'request'
      mode: SearchExecutionMode
      request: SearchRequestDto
      sort?: SearchSort
      offset?: number
    }

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
  if (command.type === 'request') {
    return resolveRequestCommand(command, currentSort)
  }

  const normalizedQuery = command.query.trim()
  const requestState = cleanAdvancedFilters(command.filters || { filters: {} })
  const { filters: requestFilters, scope } =
    splitAdvancedSearchState(requestState)
  const hasRequestFilters = hasAdvancedFilterValue(requestState)
  if (!normalizedQuery && !hasRequestFilters) return null

  const sort = normalizeSearchSort(command.sort ?? currentSort)
  const mode = executionModeForCommand(command)
  const offset = command.type === 'append' ? command.offset : 0
  const request: SearchRequestDto = {
    query: normalizedQuery,
    filters: searchRequestHasFilters({ filters: requestFilters })
      ? requestFilters
      : undefined,
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

function resolveRequestCommand(
  command: Extract<SearchCommand, { type: 'request' }>,
  currentSort: SearchSort
): ResolvedSearchCommand | null {
  const normalizedRequest = coerceSearchRequestDto(command.request)
  const sort = normalizeSearchSort(command.sort ?? normalizedRequest.sort ?? currentSort)
  const offset =
    command.mode === 'append'
      ? command.offset ?? command.request.pagination?.offset ?? 0
      : 0
  const request: SearchRequestDto = {
    ...normalizedRequest,
    sort,
    pagination: {
      limit: command.request.pagination?.limit ?? SEARCH_PAGE_SIZE,
      offset,
    },
  }
  const filters = advancedStateFromRequest(request)
  const hasRequestFilters = hasAdvancedFilterValue(filters)
  if (!request.query.trim() && !hasRequestFilters) return null

  return {
    mode: command.mode,
    query: request.query,
    filters,
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
    case 'request':
      return command.mode
  }
}
