import {
  advancedFiltersChanged,
  hasAdvancedFilterValue,
} from './search-filter-model'
import type { SearchControllerState } from './search-controller-state'
import type { SearchRecoveryGroup } from '@uiuc-course-search/query-types'

export type SearchViewModel = {
  activeRequestQuery: string
  hasActiveRequest: boolean
  resultCountLabel: string
  showingResultsLabel: string
  resultsHeadingLabel: string
  hasAdvancedDraftChanges: boolean
  showFirstRunExamples: boolean
  isRefreshingResults: boolean
  showInitialSkeleton: boolean
  recoveryGroups: SearchRecoveryGroup[]
}

export function buildSearchViewModel(
  state: SearchControllerState
): SearchViewModel {
  const hasActiveStructuredFilters = hasAdvancedFilterValue(
    state.activeAdvancedFilters
  )
  const hasActiveRequest =
    state.activeSearchText.trim().length > 0 ||
    hasActiveStructuredFilters ||
    state.meta !== null ||
    state.loading ||
    state.loadingMore
  const activeRequestQuery = hasActiveRequest
    ? state.activeSearchText
    : state.query.trim()
  const resultCountLabel =
    state.pagination?.total !== undefined
      ? `${state.pagination.total.toLocaleString()} ${
          state.pagination.total === 1 ? 'result' : 'results'
        }`
      : `${state.results.length.toLocaleString()} ${
          state.results.length === 1 ? 'result' : 'results'
        }`
  const showingResultsLabel =
    state.pagination?.total !== undefined &&
    state.pagination.total > state.results.length
      ? `Showing ${state.results.length.toLocaleString()} of ${state.pagination.total.toLocaleString()}`
      : `Showing ${state.results.length.toLocaleString()}`
  const resultsHeadingLabel = state.meta?.query.raw
    ? `Results for ${state.meta.query.raw}`
    : 'Results matching filters'
  const hasAdvancedDraftChanges = state.meta
    ? advancedFiltersChanged(state.meta.ui?.advanced || {}, state.advancedDraft)
    : hasAdvancedFilterValue(state.advancedDraft)
  const showFirstRunExamples =
    !state.meta && !state.loading && !hasActiveRequest && !state.error
  const isRefreshingResults =
    state.loading && (state.meta !== null || state.results.length > 0)
  const showInitialSkeleton = state.loading && !isRefreshingResults
  const recoveryGroups = state.meta?.fallback?.recoveryGroups ?? []

  return {
    activeRequestQuery,
    hasActiveRequest,
    resultCountLabel,
    showingResultsLabel,
    resultsHeadingLabel,
    hasAdvancedDraftChanges,
    showFirstRunExamples,
    isRefreshingResults,
    showInitialSkeleton,
    recoveryGroups,
  }
}
