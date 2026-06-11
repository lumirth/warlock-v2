import {
  normalizeSearchRequestDto,
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
}

export type SearchCommand =
  | ({ type: 'submit' } & BaseSearchCommand)
  | ({ type: 'refine' } & BaseSearchCommand)
  | {
      type: 'request'
      mode: SearchExecutionMode
      request: SearchRequestDto
      sort?: SearchSort
      offset?: number
    }

type ResolvedSearchCommand = {
  mode: SearchExecutionMode
  sort: SearchSort
  request: SearchRequestDto
}

export function resolveSearchCommand(
  command: SearchCommand,
  currentSort: SearchSort,
): ResolvedSearchCommand | null {
  if (command.type === 'request') {
    return resolveRequestCommand(command)
  }

  const normalizedQuery = command.query.trim()
  const requestState = cleanAdvancedFilters(command.filters || { filters: {} })
  const { filters: requestFilters, scope } =
    splitAdvancedSearchState(requestState)
  const hasRequestFilters = hasAdvancedFilterValue(requestState)
  if (!normalizedQuery && !hasRequestFilters) return null

  const sort = normalizeSearchSort(currentSort)
  const request: SearchRequestDto = {
    query: normalizedQuery,
    filters: searchRequestHasFilters({ filters: requestFilters })
      ? requestFilters
      : undefined,
    scope,
    sort,
    pagination: {
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
    },
  }

  return {
    mode: command.type === 'submit' ? 'replace' : 'refine',
    sort,
    request,
  }
}

function resolveRequestCommand(
  command: Extract<SearchCommand, { type: 'request' }>
): ResolvedSearchCommand | null {
  const normalizedRequest = normalizeSearchRequestDto(command.request)
  const sort = normalizeSearchSort(command.sort ?? normalizedRequest.sort)
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
    sort,
    request,
  }
}
