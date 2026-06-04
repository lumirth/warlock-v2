import type { Dispatch } from 'react'
import type { AdvancedSearchStateDto } from '@uiuc-course-search/query-types'
import {
  advancedFiltersChanged,
  advancedFiltersContradictQuery,
  cleanAdvancedFilters,
  hasAdvancedFilterValue,
  meaningfulResidualQuery,
} from './search-filter-model'
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
    const previousAdvanced = state.meta?.ui?.advanced || {}
    const changed = advancedFiltersChanged(previousAdvanced, state.advancedDraft)
    const contradictsQuery = advancedFiltersContradictQuery(
      previousAdvanced,
      state.advancedDraft
    )
    const freeTextQuery = state.inputDirty
      ? state.query.trim()
      : contradictsQuery
        ? meaningfulResidualQuery(state.meta?.query.residual || '')
        : activeRequestQuery
    const nextFilters = cleanAdvancedFilters(state.advancedDraft)
    const nextQuery = changed ? freeTextQuery : activeRequestQuery

    if (!nextQuery.trim() && !hasAdvancedFilterValue(nextFilters)) {
      dispatch({ type: 'search/cleared' })
      return
    }
    if (contradictsQuery && !state.inputDirty) {
      dispatch({ type: 'query/changed', value: freeTextQuery })
    }

    executeSearch({
      type: 'refine',
      query: nextQuery,
      filters: nextFilters,
    })
  }

  const resetAdvancedDraft = () => {
    dispatch({
      type: 'advanced/draft-replaced',
      value: state.meta?.ui?.advanced || {},
    })
  }

  return {
    setAdvancedOpen,
    updateAdvancedDraft,
    applyAdvancedSearch,
    resetAdvancedDraft,
  }
}
