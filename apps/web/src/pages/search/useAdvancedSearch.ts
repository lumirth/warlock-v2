import type { Dispatch } from 'react'
import type { AdvancedSearchStateDto } from '@uiuc-course-search/query-types'
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

  const updateAdvancedDraft = <Key extends keyof AdvancedSearchStateDto>(
    key: Key,
    value: AdvancedSearchStateDto[Key]
  ) =>
    dispatch({
      type: 'advanced/draft-field-changed',
      key,
      value,
    })

  const applyAdvancedSearch = () => {
    const activeAdvanced = state.session.activeRequest
      ? advancedStateFromRequest(state.session.activeRequest)
      : {}
    const plan = planAdvancedSearchApply({
      activeRequestQuery,
      currentInputQuery: state.draft.query,
      inputDirty: state.draft.inputDirty,
      interpretedAdvanced: activeAdvanced,
      draft: state.draft.advancedDraft,
      interpretedQuery: state.session.activeRequest?.query,
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
    dispatch({
      type: 'advanced/draft-replaced',
      value: state.session.activeRequest
        ? advancedStateFromRequest(state.session.activeRequest)
        : {},
    })
  }

  return {
    setAdvancedOpen,
    updateAdvancedDraft,
    applyAdvancedSearch,
    resetAdvancedDraft,
  }
}
