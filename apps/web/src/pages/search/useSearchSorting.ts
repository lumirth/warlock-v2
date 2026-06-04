import { useEffect, type Dispatch } from 'react'
import {
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  type SearchSort,
  type SortField,
} from '@uiuc-course-search/query-types'
import type {
  SearchControllerAction,
  SearchControllerState,
} from './search-controller-state'
import {
  nextSortForField,
  normalizeSearchSort,
  writeStoredResultViewMode,
  type ResultViewMode,
} from './search-sort-model'
import type { SearchViewModel } from './search-view-model'
import type { ExecuteSearch } from './useSearchExecution'

export function useSearchSorting({
  state,
  derived,
  dispatch,
  executeSearch,
}: {
  state: SearchControllerState
  derived: SearchViewModel
  dispatch: Dispatch<SearchControllerAction>
  executeSearch: ExecuteSearch
}) {
  useEffect(() => {
    writeStoredResultViewMode(state.resultViewMode)
  }, [state.resultViewMode])

  const setResultViewMode = (value: ResultViewMode) =>
    dispatch({ type: 'result-view/changed', value })

  const applySort = (nextSort: SearchSort) => {
    const normalizedSort = normalizeSearchSort(nextSort)
    executeSearch({
      type: 'refresh',
      query: derived.activeRequestQuery,
      filters: state.activeAdvancedFilters,
      sort: normalizedSort,
    })
  }

  const handleSortFieldChange = (field: SortField) => {
    applySort({
      field,
      direction: SEARCH_SORT_DEFAULT_DIRECTIONS[field],
    })
  }

  const toggleSortDirection = () => {
    if (state.sort.field === 'relevance') return

    applySort({
      field: state.sort.field,
      direction: state.sort.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  const handleTableSort = (field: Exclude<SortField, 'relevance'>) => {
    applySort(nextSortForField(field, state.sort))
  }

  return {
    setResultViewMode,
    handleSortFieldChange,
    toggleSortDirection,
    handleTableSort,
  }
}
