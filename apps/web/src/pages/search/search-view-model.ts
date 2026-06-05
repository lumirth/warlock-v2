import {
  advancedStateFromRequest,
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
    state.session.activeAdvancedFilters
  )
  const hasActiveRequest =
    state.session.activeSearchText.trim().length > 0 ||
    hasActiveStructuredFilters ||
    state.session.meta !== null ||
    state.session.loading ||
    state.session.loadingMore
  const activeRequestQuery = hasActiveRequest
    ? state.session.activeSearchText
    : state.draft.query.trim()
  const resultCountLabel =
    state.session.pagination?.total !== undefined
      ? `${state.session.pagination.total.toLocaleString()} ${
          state.session.pagination.total === 1 ? 'result' : 'results'
        }`
      : `${state.session.results.length.toLocaleString()} ${
          state.session.results.length === 1 ? 'result' : 'results'
        }`
  const showingResultsLabel =
    state.session.pagination?.total !== undefined &&
    state.session.pagination.total > state.session.results.length
      ? `Showing ${state.session.results.length.toLocaleString()} of ${state.session.pagination.total.toLocaleString()}`
      : `Showing ${state.session.results.length.toLocaleString()}`
  const resultsHeadingLabel = state.session.meta?.query.raw
    ? `Results for ${state.session.meta.query.raw}`
    : 'Results matching filters'
  const hasAdvancedDraftChanges = state.session.meta
    ? advancedFiltersChanged(
        state.session.meta.interpretedRequest
          ? advancedStateFromRequest(state.session.meta.interpretedRequest)
          : {},
        state.draft.advancedDraft
      )
    : hasAdvancedFilterValue(state.draft.advancedDraft)
  const showFirstRunExamples =
    !state.session.meta && !state.session.loading && !hasActiveRequest && !state.session.error
  const isRefreshingResults =
    state.session.loading && (state.session.meta !== null || state.session.results.length > 0)
  const showInitialSkeleton = state.session.loading && !isRefreshingResults
  const recoveryGroups = state.session.meta?.fallback?.recoveryGroups ?? []

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
