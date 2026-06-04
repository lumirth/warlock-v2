import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
} from 'react'
import {
  splitAdvancedSearchState,
  type AdvancedSearchStateDto,
  type SearchRequestDto,
  type SearchSort,
} from '@uiuc-course-search/query-types'
import { api } from '../../lib/api-client'
import { cleanAdvancedFilters, hasAdvancedFilterValue } from './search-filter-model'
import { SEARCH_PAGE_SIZE } from './search-options'
import { normalizeSearchSort } from './search-sort-model'
import type {
  SearchControllerAction,
  SearchExecutionMode,
} from './search-controller-state'

export type SearchExecutionOptions =
  | {
      mode?: 'replace' | 'refine' | 'refresh'
      filters?: AdvancedSearchStateDto
      sort?: SearchSort
    }
  | {
      mode: 'append'
      offset: number
      filters?: AdvancedSearchStateDto
      sort?: SearchSort
    }

export type ExecuteSearch = (
  searchText: string,
  options?: SearchExecutionOptions
) => void

export function useSearchExecution({
  dispatch,
  currentSort,
}: {
  dispatch: Dispatch<SearchControllerAction>
  currentSort: SearchSort
}): { executeSearch: ExecuteSearch } {
  const searchController = useRef<AbortController | null>(null)

  const executeSearch = useCallback<ExecuteSearch>(
    (searchText, options = {}) => {
      void runSearch({
        dispatch,
        currentSort,
        searchController,
        searchText,
        options,
      })
    },
    [currentSort, dispatch]
  )

  return { executeSearch }
}

async function runSearch({
  dispatch,
  currentSort,
  searchController,
  searchText,
  options,
}: {
  dispatch: Dispatch<SearchControllerAction>
  currentSort: SearchSort
  searchController: MutableRefObject<AbortController | null>
  searchText: string
  options: SearchExecutionOptions
}) {
  const normalizedQuery = searchText.trim()
  const requestState = cleanAdvancedFilters(options.filters || {})
  const { filters: requestFilters, scope } =
    splitAdvancedSearchState(requestState)
  const hasRequestFilters = hasAdvancedFilterValue(requestFilters)
  const requestSort = normalizeSearchSort(options.sort ?? currentSort)
  if (!normalizedQuery && !hasRequestFilters) return
  const mode: SearchExecutionMode = options.mode ?? 'replace'
  const offset = options.mode === 'append' ? options.offset : 0

  if (searchController.current) {
    searchController.current.abort()
  }
  const controller = new AbortController()
  searchController.current = controller

  dispatch({
    type: 'search/started',
    query: normalizedQuery,
    filters: requestState,
    mode,
    sort: requestSort,
  })

  try {
    const request: SearchRequestDto = {
      query: normalizedQuery,
      filters: hasRequestFilters ? requestFilters : undefined,
      scope,
      sort: requestSort,
      pagination: {
        limit: SEARCH_PAGE_SIZE,
        offset,
      },
    }
    const data = await api.search(request, { signal: controller.signal })
    if (searchController.current !== controller) return
    dispatch({
      type: 'search/succeeded',
      response: data,
      mode,
      requestSort,
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return
    if (searchController.current !== controller) return
    dispatch({
      type: 'search/failed',
      message: 'Give it another moment, or try a broader search.',
    })
  } finally {
    if (searchController.current === controller) {
      dispatch({ type: 'search/finished' })
      searchController.current = null
    }
  }
}
