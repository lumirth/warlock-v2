import { AlertCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SearchTermOptionsDto } from '@uiuc-course-search/query-types'
import { FeedbackButton } from '../components/FeedbackButton'
import { PageContainer } from '@/components/PageContainer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { api } from '../lib/api-client'
import { RefinePanel } from './search/RefinePanel'
import { ResultsList } from './search/ResultsList'
import { SearchForm } from './search/SearchForm'
import { useSearchController } from './search/useSearchController'
import {
  readSearchUrlState,
  writeResultViewToSearch,
  writeSearchUrlState,
} from './search/search-url-state'
import type { ResultViewMode } from './search/search-sort-model'

export function SearchPage({ includeH1 = true }: { includeH1?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [initialUrlState] = useState(() =>
    readSearchUrlState(new URLSearchParams(location.search))
  )
  const handledSearchRef = useRef(location.search)
  const pendingSearchRef = useRef<string | null>(null)
  const resultViewRef = useRef<ResultViewMode>(initialUrlState.view ?? 'cards')
  const [urlError, setUrlError] = useState(initialUrlState.error)

  const handleRequestChange = useCallback(
    (
      request: Parameters<typeof writeSearchUrlState>[0],
      mode: 'replace' | 'refine' | 'append' | 'refresh'
    ) => {
      const nextSearch = writeSearchUrlState(request, resultViewRef.current)
      if (
        nextSearch === location.search ||
        nextSearch === pendingSearchRef.current
      ) {
        return
      }
      pendingSearchRef.current = nextSearch
      navigate(
        { pathname: '/', search: nextSearch },
        {
          replace: mode === 'append' || mode === 'refresh',
        }
      )
    },
    [location.search, navigate]
  )

  const clearSearchUrl = useCallback(() => {
    if (!location.search) return
    pendingSearchRef.current = ''
    navigate({ pathname: '/', search: '' })
  }, [location.search, navigate])

  const { state, derived, actions } = useSearchController({
    initialRequest: initialUrlState.request,
    initialResultViewMode: initialUrlState.view,
    onRequestChange: handleRequestChange,
    onClear: clearSearchUrl,
  })
  const searchActionsRef = useRef(actions)
  const [termOptions, setTermOptions] = useState<SearchTermOptionsDto | null>(
    null
  )
  const [termOptionsError, setTermOptionsError] = useState(false)
  const [termOptionsAttempt, setTermOptionsAttempt] = useState(0)

  useEffect(() => {
    searchActionsRef.current = actions
  }, [actions])

  useEffect(() => {
    resultViewRef.current = state.draft.resultViewMode
  }, [state.draft.resultViewMode])

  useEffect(() => {
    document.title = state.session.meta
      ? `${derived.resultsHeadingLabel} · UIUC Course Search`
      : 'UIUC Course Search'
  }, [derived.resultsHeadingLabel, state.session.meta])

  useEffect(() => {
    if (pendingSearchRef.current !== null) {
      if (location.search === pendingSearchRef.current) {
        handledSearchRef.current = location.search
        pendingSearchRef.current = null
        return
      }
      pendingSearchRef.current = null
    }
    if (location.search === handledSearchRef.current) return
    handledSearchRef.current = location.search
    const nextUrlState = readSearchUrlState(
      new URLSearchParams(location.search)
    )
    setUrlError(nextUrlState.error)

    if (nextUrlState.request) {
      searchActionsRef.current.restoreRequest(
        nextUrlState.request,
        nextUrlState.view ?? 'cards'
      )
    } else {
      searchActionsRef.current.resetFromUrl(nextUrlState.view ?? 'cards')
    }
  }, [location.search])

  useEffect(() => {
    const controller = new AbortController()

    api
      .getTermOptions(controller.signal)
      .then((options) => {
        setTermOptions(options)
        setTermOptionsError(false)
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') {
          setTermOptionsError(true)
        }
      })

    return () => controller.abort()
  }, [termOptionsAttempt])

  const handleViewChange = (view: ResultViewMode) => {
    resultViewRef.current = view
    actions.setResultViewMode(view)
    const nextSearch = writeResultViewToSearch(location.search, view)
    pendingSearchRef.current = nextSearch
    navigate({ pathname: '/', search: nextSearch }, { replace: true })
  }

  const resetBrokenSearchLink = () => {
    setUrlError(null)
    actions.resetFromUrl('cards')
    clearSearchUrl()
  }

  return (
    <PageContainer className="py-4 sm:py-6">
      {includeH1 && <h1 className="sr-only">UIUC Course Search</h1>}
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <SearchForm
          query={state.draft.query}
          showFirstRunExamples={derived.showFirstRunExamples}
          onQueryChange={actions.setQuery}
          onSubmit={actions.handleSearchSubmit}
          onExampleSearch={actions.runExampleSearch}
        />

        {urlError && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertTitle>That search link is not valid</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{urlError}</span>
              <button
                type="button"
                className="min-h-8 font-medium underline underline-offset-4"
                onClick={resetBrokenSearchLink}
              >
                Start a new search
              </button>
            </AlertDescription>
          </Alert>
        )}

        {state.session.error && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertTitle>That search did not go through</AlertTitle>
            <AlertDescription>{state.session.error}</AlertDescription>
          </Alert>
        )}

        <RefinePanel
          meta={state.session.meta}
          resultCountLabel={derived.resultCountLabel}
          availableTerms={termOptions?.terms}
          termOptionsError={termOptionsError}
          termOptionsLoading={!termOptions && !termOptionsError}
          advancedDraftErrors={derived.advancedDraftErrors}
          hasAdvancedDraftErrors={derived.hasAdvancedDraftErrors}
          advancedOpen={state.draft.advancedOpen}
          advancedDraft={state.draft.advancedDraft}
          hasAdvancedDraftChanges={derived.hasAdvancedDraftChanges}
          onAdvancedOpenChange={actions.setAdvancedOpen}
          onAdvancedDraftFilterChange={actions.updateAdvancedDraftFilter}
          onAdvancedDraftScopeChange={actions.updateAdvancedDraftScope}
          onRemoveChip={actions.removeChip}
          onAmbiguityAction={actions.applyAmbiguityAction}
          onApplyAdvancedSearch={actions.applyAdvancedSearch}
          onResetAdvancedDraft={actions.resetAdvancedDraft}
          onRetryTermOptions={() => {
            setTermOptions(null)
            setTermOptionsError(false)
            setTermOptionsAttempt((attempt) => attempt + 1)
          }}
        />

        <ResultsList
          meta={state.session.meta}
          results={state.session.results}
          pagination={state.session.pagination}
          loading={state.session.loading}
          loadingMore={state.session.loadingMore}
          sort={state.session.sort}
          resultViewMode={state.draft.resultViewMode}
          showInitialSkeleton={derived.showInitialSkeleton}
          isRefreshingResults={derived.isRefreshingResults}
          resultsHeadingLabel={derived.resultsHeadingLabel}
          showingResultsLabel={derived.showingResultsLabel}
          feedbackAction={
            state.session.meta ? (
              <FeedbackButton
                buttonLabel="Results not right?"
                page="search"
                kind="search_results"
                issue="expected_different_results"
                buttonVariant="outline"
                context={{
                  query: state.session.meta.nextRequest.query,
                  metadata: {
                    resultCount:
                      state.session.pagination?.totalResults ??
                      state.session.results.length,
                    hasMore: state.session.pagination?.hasMore === true,
                    typedQuery: state.draft.query.trim() || null,
                    effectiveQuery: derived.activeRequestQuery || null,
                  },
                }}
              />
            ) : null
          }
          onSortFieldChange={actions.handleSortFieldChange}
          onDirectionToggle={actions.toggleSortDirection}
          onViewChange={handleViewChange}
          onTableSort={actions.handleTableSort}
          onRemoveChip={actions.removeChip}
          onLoadMore={actions.loadMoreResults}
          returnTo={`${location.pathname}${location.search}`}
        />
      </div>
    </PageContainer>
  )
}
