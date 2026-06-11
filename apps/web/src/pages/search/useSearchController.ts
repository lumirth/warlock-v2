import { useEffect, useReducer, type FormEvent } from 'react'
import {
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  type SearchAmbiguityActionDto,
  type SearchChipDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchRequestDto,
  type SearchScope,
  type SearchSort,
  type SortField,
} from '@uiuc-course-search/query-types'
import {
  INITIAL_SEARCH_CONTROLLER_STATE,
  searchControllerReducer,
} from './search-controller-state'
import { planAdvancedSearchApply } from './advanced-search-planner'
import {
  advancedStateFromRequest,
  cleanAdvancedFilters,
  hasSearchableAdvancedFilterValue,
} from './search-filter-model'
import {
  nextSortForField,
  normalizeSearchSort,
  readStoredResultViewMode,
  writeStoredResultViewMode,
  type ResultViewMode,
} from './search-sort-model'
import { buildSearchViewModel } from './search-view-model'
import { useSearchExecution } from './useSearchExecution'

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

  useEffect(() => {
    writeStoredResultViewMode(state.draft.resultViewMode)
  }, [state.draft.resultViewMode])

  const runRefinementRequest = (request: SearchRequestDto) => {
    const draft = cleanAdvancedFilters(advancedStateFromRequest(request))
    dispatch({ type: 'advanced/draft-replaced', value: draft })
    if (!request.query.trim() && !hasSearchableAdvancedFilterValue(draft)) {
      dispatch({ type: 'search/cleared' })
      return
    }
    executeSearch({ type: 'request', mode: 'refine', request })
  }

  const applySort = (sort: SearchSort) => {
    if (!state.session.activeRequest) return
    executeSearch({
      type: 'request',
      mode: 'refresh',
      request: state.session.activeRequest,
      sort: normalizeSearchSort(sort),
    })
  }

  const applyAdvancedSearch = () => {
    const interpretedRequest =
      state.session.meta?.interpretedRequest ?? state.session.activeRequest
    const plan = planAdvancedSearchApply({
      activeRequestQuery: derived.interpretedRequestQuery,
      currentInputQuery: state.draft.query,
      inputDirty: state.draft.inputDirty,
      interpretedAdvanced: interpretedRequest
        ? advancedStateFromRequest(interpretedRequest)
        : { filters: {} },
      draft: state.draft.advancedDraft,
      interpretedQuery: interpretedRequest?.query,
    })

    if (plan.kind === 'clear') {
      dispatch({ type: 'search/cleared' })
      return
    }
    if (plan.syncInputQuery !== undefined) {
      dispatch({ type: 'query/changed', value: plan.syncInputQuery })
    }
    executeSearch({ type: 'refine', query: plan.query, filters: plan.filters })
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    executeSearch({ type: 'submit', query: state.draft.query })
  }

  return {
    state,
    derived,
    actions: {
      setQuery: (value: string) => dispatch({ type: 'query/changed', value }),
      handleSearchSubmit,
      runExampleSearch: (query: string) => executeSearch({ type: 'submit', query }),
      setAdvancedOpen: (value: boolean) =>
        dispatch({ type: 'advanced/open-changed', value }),
      updateAdvancedDraftFilter: <Key extends SearchRequestFilterKey>(
        key: Key,
        value: SearchRequestFiltersDto[Key]
      ) => dispatch({ type: 'advanced/draft-filter-changed', key, value }),
      updateAdvancedDraftScope: (value?: SearchScope) =>
        dispatch({ type: 'advanced/draft-scope-changed', value }),
      applyAdvancedSearch,
      resetAdvancedDraft: () => {
        const interpreted =
          state.session.meta?.interpretedRequest ?? state.session.activeRequest
        dispatch({
          type: 'advanced/draft-replaced',
          value: interpreted ? advancedStateFromRequest(interpreted) : { filters: {} },
        })
      },
      removeChip: (chip: SearchChipDto) => runRefinementRequest(chip.removeRequest),
      applyAmbiguityAction: (action: SearchAmbiguityActionDto) =>
        runRefinementRequest(action.nextRequest),
      setResultViewMode: (value: ResultViewMode) =>
        dispatch({ type: 'result-view/changed', value }),
      handleSortFieldChange: (field: SortField) =>
        applySort({ field, direction: SEARCH_SORT_DEFAULT_DIRECTIONS[field] }),
      toggleSortDirection: () => {
        if (state.session.sort.field === 'relevance') return
        applySort({
          field: state.session.sort.field,
          direction: state.session.sort.direction === 'asc' ? 'desc' : 'asc',
        })
      },
      handleTableSort: (field: Exclude<SortField, 'relevance'>) =>
        applySort(nextSortForField(field, state.session.sort)),
      loadMoreResults: () => {
        if (!state.session.pagination?.hasMore || !state.session.activeRequest) return
        executeSearch({
          type: 'request',
          mode: 'append',
          request: state.session.activeRequest,
          offset:
            state.session.pagination.nextOffset
            ?? state.session.pagination.offset + state.session.pagination.limit,
          sort: state.session.sort,
        })
      },
    },
  }
}
