import {
  advancedStateFromRequest,
  advancedFiltersChanged,
  hasAdvancedFilterValue,
  validateAdvancedFilters,
  type AdvancedFilterErrors,
} from './search-filter-model'
import type { SearchControllerState } from './search-controller-state'
import type { AdvancedSearchStateDto } from '@uiuc-course-search/query-types'

type SearchViewModel = {
  activeRequestQuery: string
  interpretedRequestQuery: string
  activeAdvancedFilters: AdvancedSearchStateDto
  hasActiveRequest: boolean
  resultCountLabel: string
  showingResultsLabel: string
  resultsHeadingLabel: string
  hasAdvancedDraftChanges: boolean
  advancedDraftErrors: AdvancedFilterErrors
  hasAdvancedDraftErrors: boolean
  showFirstRunExamples: boolean
  isRefreshingResults: boolean
  showInitialSkeleton: boolean
}

export function buildSearchViewModel(
  state: SearchControllerState
): SearchViewModel {
  const interpretedRequest =
    state.session.meta?.interpretedRequest ?? state.session.activeRequest
  const activeAdvancedFilters = interpretedRequest
    ? advancedStateFromRequest(interpretedRequest)
    : { filters: {} }
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
    ? (state.session.activeRequest?.query ?? '')
    : state.draft.query.trim()
  const interpretedRequestQuery =
    interpretedRequest?.query ?? activeRequestQuery
  const totalResults =
    state.session.pagination?.totalResults ?? state.session.results.length
  const browseableResults =
    state.session.pagination?.browseableResults ?? totalResults
  const searchIsDegraded =
    state.session.meta?.retrieval?.degraded === true ||
    state.session.pagination?.countIsComplete === false
  const totalResultsLabel = `${
    searchIsDegraded ? 'at least ' : ''
  }${totalResults.toLocaleString()}`
  const resultCountLabel = `${searchIsDegraded ? 'At least ' : ''}${totalResults.toLocaleString()} ${
    totalResults === 1 ? 'result' : 'results'
  }`
  const showingResultsLabel =
    totalResults > browseableResults &&
    state.session.results.length >= browseableResults
      ? `Showing top ${browseableResults.toLocaleString()} of ${totalResultsLabel}`
      : searchIsDegraded || totalResults > state.session.results.length
        ? `Showing ${state.session.results.length.toLocaleString()} of ${totalResultsLabel}`
        : `Showing ${state.session.results.length.toLocaleString()}`
  const resultsHeadingLabel = state.session.meta?.nextRequest.query
    ? `Results for ${state.session.meta.nextRequest.query}`
    : 'Results matching filters'
  const advancedDraftValidation = validateAdvancedFilters(
    state.draft.advancedDraft
  )
  const hasAdvancedDraftChanges = state.session.meta
    ? advancedFiltersChanged(activeAdvancedFilters, state.draft.advancedDraft)
    : hasAdvancedFilterValue(state.draft.advancedDraft)
  const showFirstRunExamples =
    !state.session.meta &&
    !state.session.loading &&
    !hasActiveRequest &&
    !state.session.error
  const isRefreshingResults =
    state.session.loading &&
    (state.session.meta !== null || state.session.results.length > 0)
  const showInitialSkeleton = state.session.loading && !isRefreshingResults

  return {
    activeRequestQuery,
    interpretedRequestQuery,
    activeAdvancedFilters,
    hasActiveRequest,
    resultCountLabel,
    showingResultsLabel,
    resultsHeadingLabel,
    hasAdvancedDraftChanges,
    advancedDraftErrors: advancedDraftValidation.errors,
    hasAdvancedDraftErrors: !advancedDraftValidation.ok,
    showFirstRunExamples,
    isRefreshingResults,
    showInitialSkeleton,
  }
}
