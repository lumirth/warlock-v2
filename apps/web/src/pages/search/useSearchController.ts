import { useEffect, useReducer, useRef, type FormEvent } from 'react'
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
  validateAdvancedFilters,
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

export function useSearchController({
  initialRequest = null,
  initialResultViewMode,
  onRequestChange,
  onClear,
}: {
  initialRequest?: SearchRequestDto | null
  initialResultViewMode?: ResultViewMode
  onRequestChange?: (
    request: SearchRequestDto,
    mode: 'replace' | 'refine' | 'append' | 'refresh'
  ) => void
  onClear?: () => void
} = {}) {
  const initialRequestRef = useRef(initialRequest)
  const [state, dispatch] = useReducer(
    searchControllerReducer,
    undefined,
    () => {
      const restoredAdvanced = initialRequest
        ? advancedStateFromRequest(initialRequest)
        : INITIAL_SEARCH_CONTROLLER_STATE.draft.advancedDraft
      const restoredSort = initialRequest?.sort
        ? normalizeSearchSort(initialRequest.sort)
        : INITIAL_SEARCH_CONTROLLER_STATE.session.sort

      return {
        ...INITIAL_SEARCH_CONTROLLER_STATE,
        draft: {
          ...INITIAL_SEARCH_CONTROLLER_STATE.draft,
          query: initialRequest?.query ?? '',
          advancedDraft: restoredAdvanced,
          resultViewMode: initialResultViewMode ?? readStoredResultViewMode(),
        },
        session: {
          ...INITIAL_SEARCH_CONTROLLER_STATE.session,
          activeRequest: initialRequest,
          sort: restoredSort,
          committedSort: restoredSort,
        },
      }
    }
  )
  const derived = buildSearchViewModel(state)
  const { executeSearch, cancelSearch } = useSearchExecution({
    dispatch,
    currentSort: state.session.sort,
    onRequestChange,
  })

  useEffect(() => {
    const request = initialRequestRef.current
    if (!request) return
    initialRequestRef.current = null
    executeSearch({ type: 'request', mode: 'replace', request })
  }, [executeSearch])

  useEffect(() => {
    writeStoredResultViewMode(state.draft.resultViewMode)
  }, [state.draft.resultViewMode])

  const runRefinementRequest = (request: SearchRequestDto) => {
    const draft = cleanAdvancedFilters(advancedStateFromRequest(request))
    dispatch({ type: 'advanced/draft-replaced', value: draft })
    if (!request.query.trim() && !hasSearchableAdvancedFilterValue(draft)) {
      cancelSearch()
      dispatch({ type: 'search/cleared' })
      onClear?.()
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
    const validation = validateAdvancedFilters(state.draft.advancedDraft)
    if (!validation.ok) {
      dispatch({ type: 'advanced/open-changed', value: true })
      return
    }
    const interpretedRequest =
      state.session.meta?.interpretedRequest ?? state.session.activeRequest
    const plan = planAdvancedSearchApply({
      activeRequestQuery: derived.interpretedRequestQuery,
      currentInputQuery: state.draft.query,
      inputDirty: state.draft.inputDirty,
      interpretedAdvanced: interpretedRequest
        ? advancedStateFromRequest(interpretedRequest)
        : { filters: {} },
      draft: validation.value,
      interpretedQuery: interpretedRequest?.query,
    })

    if (plan.kind === 'clear') {
      cancelSearch()
      dispatch({ type: 'search/cleared' })
      onClear?.()
      return
    }
    if (plan.syncInputQuery !== undefined) {
      dispatch({ type: 'query/changed', value: plan.syncInputQuery })
    }
    dispatch({ type: 'advanced/open-changed', value: false })
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
      runExampleSearch: (query: string) =>
        executeSearch({ type: 'submit', query }),
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
          value: interpreted
            ? advancedStateFromRequest(interpreted)
            : { filters: {} },
        })
      },
      removeChip: (chip: SearchChipDto) =>
        runRefinementRequest(chip.removeRequest),
      applyAmbiguityAction: (action: SearchAmbiguityActionDto) =>
        runRefinementRequest(action.nextRequest),
      restoreRequest: (
        request: SearchRequestDto,
        resultViewMode?: ResultViewMode
      ) => {
        dispatch({
          type: 'advanced/draft-replaced',
          value: advancedStateFromRequest(request),
        })
        if (resultViewMode) {
          dispatch({ type: 'result-view/changed', value: resultViewMode })
        }
        executeSearch({ type: 'request', mode: 'replace', request })
      },
      clearSearch: () => {
        cancelSearch()
        dispatch({ type: 'search/cleared' })
        onClear?.()
      },
      resetFromUrl: (resultViewMode?: ResultViewMode) => {
        cancelSearch()
        dispatch({ type: 'search/cleared' })
        if (resultViewMode) {
          dispatch({ type: 'result-view/changed', value: resultViewMode })
        }
      },
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
        if (!state.session.pagination?.hasMore || !state.session.activeRequest)
          return
        executeSearch({
          type: 'request',
          mode: 'append',
          request: state.session.activeRequest,
          offset:
            state.session.pagination.nextOffset ??
            state.session.pagination.offset + state.session.pagination.limit,
          sort: state.session.sort,
        })
      },
    },
  }
}
