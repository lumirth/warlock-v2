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
import type { ExecuteSearch } from './useSearchExecution'

export function useSearchSorting({
  state,
  dispatch,
  executeSearch,
}: {
  state: SearchControllerState
  dispatch: Dispatch<SearchControllerAction>
  executeSearch: ExecuteSearch
}) {
  useEffect(() => {
    writeStoredResultViewMode(state.draft.resultViewMode)
  }, [state.draft.resultViewMode])

  const setResultViewMode = (value: ResultViewMode) =>
    dispatch({ type: 'result-view/changed', value })

  const applySort = (nextSort: SearchSort) => {
    if (!state.session.activeRequest) return

    const normalizedSort = normalizeSearchSort(nextSort)
    executeSearch({
      type: 'request',
      mode: 'refresh',
      request: state.session.activeRequest,
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
    if (state.session.sort.field === 'relevance') return

    applySort({
      field: state.session.sort.field,
      direction: state.session.sort.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  const handleTableSort = (field: Exclude<SortField, 'relevance'>) => {
    applySort(nextSortForField(field, state.session.sort))
  }

  return {
    setResultViewMode,
    handleSortFieldChange,
    toggleSortDirection,
    handleTableSort,
  }
}
