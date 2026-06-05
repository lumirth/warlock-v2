import type { Dispatch } from 'react'
import type {
  SearchRequestFilterKey,
  SearchRequestFiltersDto,
  SearchScope,
} from '@uiuc-course-search/query-types'
import { planAdvancedSearchApply } from './advanced-search-planner'
import { advancedStateFromRequest } from './search-filter-model'
import type {
  SearchControllerAction,
  SearchControllerState,
} from './search-controller-state'
import type { ExecuteSearch } from './useSearchExecution'

export function useAdvancedSearch({
  state,
  dispatch,
  activeRequestQuery,
  executeSearch,
}: {
  state: SearchControllerState
  dispatch: Dispatch<SearchControllerAction>
  activeRequestQuery: string
  executeSearch: ExecuteSearch
}) {
  const setAdvancedOpen = (value: boolean) =>
    dispatch({ type: 'advanced/open-changed', value })

  const updateAdvancedDraftFilter = <Key extends SearchRequestFilterKey>(
    key: Key,
    value: SearchRequestFiltersDto[Key]
  ) =>
    dispatch({
      type: 'advanced/draft-filter-changed',
      key,
      value,
    })
  const updateAdvancedDraftScope = (value?: SearchScope) =>
    dispatch({ type: 'advanced/draft-scope-changed', value })

  const applyAdvancedSearch = () => {
    const interpretedRequest =
      state.session.meta?.interpretedRequest ?? state.session.activeRequest
    const activeAdvanced = interpretedRequest
      ? advancedStateFromRequest(interpretedRequest)
      : { filters: {} }
    const plan = planAdvancedSearchApply({
      activeRequestQuery,
      currentInputQuery: state.draft.query,
      inputDirty: state.draft.inputDirty,
      interpretedAdvanced: activeAdvanced,
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

    executeSearch({
      type: 'refine',
      query: plan.query,
      filters: plan.filters,
    })
  }

  const resetAdvancedDraft = () => {
    const interpretedRequest =
      state.session.meta?.interpretedRequest ?? state.session.activeRequest
    dispatch({
      type: 'advanced/draft-replaced',
      value: interpretedRequest
        ? advancedStateFromRequest(interpretedRequest)
        : { filters: {} },
    })
  }

  return {
    setAdvancedOpen,
    updateAdvancedDraftFilter,
    updateAdvancedDraftScope,
    applyAdvancedSearch,
    resetAdvancedDraft,
  }
}
