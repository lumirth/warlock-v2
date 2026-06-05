import { useReducer, type FormEvent } from 'react'
import {
  INITIAL_SEARCH_CONTROLLER_STATE,
  searchControllerReducer,
} from './search-controller-state'
import { buildSearchViewModel } from './search-view-model'
import { useAdvancedSearch } from './useAdvancedSearch'
import { useSearchExecution } from './useSearchExecution'
import { useSearchPagination } from './useSearchPagination'
import { useSearchRefinements } from './useSearchRefinements'
import { useSearchSorting } from './useSearchSorting'
import { readStoredResultViewMode } from './search-sort-model'

export function useSearchController() {
  const [state, dispatch] = useReducer(
    searchControllerReducer,
    undefined,
    () => ({
      ...INITIAL_SEARCH_CONTROLLER_STATE,
      draft: {
        ...INITIAL_SEARCH_CONTROLLER_STATE.draft,
        resultViewMode: readStoredResultViewMode(),
      },
    })
  )
  const derived = buildSearchViewModel(state)
  const { executeSearch } = useSearchExecution({
    dispatch,
    currentSort: state.session.sort,
  })
  const advancedActions = useAdvancedSearch({
    state,
    dispatch,
    activeRequestQuery: derived.activeRequestQuery,
    executeSearch,
  })
  const refinementActions = useSearchRefinements({
    state,
    derived,
    dispatch,
    executeSearch,
  })
  const sortingActions = useSearchSorting({
    state,
    derived,
    dispatch,
    executeSearch,
  })
  const paginationActions = useSearchPagination({
    state,
    derived,
    executeSearch,
  })

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    executeSearch({ type: 'submit', query: state.draft.query })
  }

  return {
    state,
    derived,
    actions: {
      setQuery: (value: string) =>
        dispatch({ type: 'query/changed', value }),
      handleSearchSubmit,
      runExampleSearch: (query: string) =>
        executeSearch({ type: 'submit', query }),
      ...advancedActions,
      ...refinementActions,
      ...sortingActions,
      ...paginationActions,
    },
  }
}
