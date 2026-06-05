import {
  advancedStateFromRequest,
  advancedFiltersChanged,
  hasAdvancedFilterValue,
} from './search-filter-model'
import type { SearchControllerState } from './search-controller-state'
import type {
  AdvancedSearchStateDto,
  SearchRecoveryGroup,
} from '@uiuc-course-search/query-types'

export type SearchViewModel = {
  activeRequestQuery: string
  activeAdvancedFilters: AdvancedSearchStateDto
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
  const activeAdvancedFilters = state.session.activeRequest
    ? advancedStateFromRequest(state.session.activeRequest)
    : {}
  const hasActiveStructuredFilters = hasAdvancedFilterValue(
    activeAdvancedFilters
  )
  const hasActiveRequest =
    (state.session.activeRequest?.query.trim().length ?? 0) > 0 ||
    hasActiveStructuredFilters ||
    state.session.meta !== null ||
    state.session.loading ||
    state.session.loadingMore
  const activeRequestQuery = hasActiveRequest
    ? state.session.activeRequest?.query ?? ''
    : state.draft.query.trim()
  const resultCountLabel =
    state.session.pagination?.resultCountLowerBound !== undefined
      ? `${state.session.pagination.resultCountLowerBound.toLocaleString()}${
          state.session.pagination.hasMore ? '+' : ''
        } ${
          state.session.pagination.resultCountLowerBound === 1 ? 'result' : 'results'
        }`
      : `${state.session.results.length.toLocaleString()} ${
          state.session.results.length === 1 ? 'result' : 'results'
        }`
  const showingResultsLabel =
    state.session.pagination?.resultCountLowerBound !== undefined &&
    state.session.pagination.resultCountLowerBound > state.session.results.length
      ? `Showing ${state.session.results.length.toLocaleString()} of ${
          state.session.pagination.hasMore ? 'at least ' : ''
        }${state.session.pagination.resultCountLowerBound.toLocaleString()}`
      : `Showing ${state.session.results.length.toLocaleString()}`
  const resultsHeadingLabel = state.session.meta?.query.raw
    ? `Results for ${state.session.meta.query.raw}`
    : 'Results matching filters'
  const hasAdvancedDraftChanges = state.session.meta
    ? advancedFiltersChanged(
        activeAdvancedFilters,
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
    activeAdvancedFilters,
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
