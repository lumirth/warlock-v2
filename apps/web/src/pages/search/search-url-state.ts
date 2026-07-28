import {
  decodeSearchRequestQuery,
  searchRequestToQueryEntries,
  searchRequestHasFilters,
  type SearchRequestDto,
} from '@uiuc-course-search/query-types'
import type { ResultViewMode } from './search-sort-model'

export type SearchUrlState = {
  request: SearchRequestDto | null
  view: ResultViewMode | undefined
  error: string | null
}

const SEARCH_PARAM_NAMES = new Set([
  'q',
  'subject',
  'number',
  'instructor',
  'term',
  'year',
  'requirement',
  'requirementMode',
  'credits',
  'days',
  'time',
  'partOfTerm',
  'online',
  'status',
  'instructor_difficulty',
  'level',
  'scope',
  'sort',
  'direction',
  'limit',
  'offset',
])

export function readSearchUrlState(params: URLSearchParams): SearchUrlState {
  const view = params.get('view') === 'table' ? 'table' : undefined
  const hasSearchState = [...params.keys()].some((key) =>
    SEARCH_PARAM_NAMES.has(key)
  )

  if (!hasSearchState) {
    return { request: null, view, error: null }
  }

  const decoded = decodeSearchRequestQuery(params)
  if (!decoded.ok) {
    return {
      request: null,
      view,
      error: `This search link could not be restored: ${decoded.error}.`,
    }
  }

  const request: SearchRequestDto = {
    ...decoded.value.request,
    pagination: decoded.value.pagination,
  }
  const hasQuery = request.query.trim().length > 0
  const hasFilters = searchRequestHasFilters({
    filters: request.filters ?? {},
  })
  const hasNonDefaultScope = request.scope === 'all'

  return {
    request: hasQuery || hasFilters || hasNonDefaultScope ? request : null,
    view,
    error: null,
  }
}

export function writeSearchUrlState(
  request: SearchRequestDto,
  view: ResultViewMode
): string {
  const canonicalRequest: SearchRequestDto = {
    ...request,
    pagination: undefined,
  }
  const params = new URLSearchParams(
    searchRequestToQueryEntries(canonicalRequest)
  )
  if (view === 'table') {
    params.set('view', 'table')
  }
  return `?${params.toString()}`
}

export function writeResultViewToSearch(
  search: string,
  view: ResultViewMode
): string {
  const params = new URLSearchParams(search)
  if (view === 'table') {
    params.set('view', 'table')
  } else {
    params.delete('view')
  }
  const next = params.toString()
  return next ? `?${next}` : ''
}
