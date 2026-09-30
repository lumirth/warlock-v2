import { AlertCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { SearchTermOptionsDto } from '@warlock-v2/query-types'
import { FeedbackButton } from '../components/FeedbackButton'
import { PageContainer } from '@/components/PageContainer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { api } from '../lib/api-client'
import { RefinePanel } from './search/RefinePanel'
import { ResultsList } from './search/ResultsList'
import { SearchForm } from './search/SearchForm'
import { useSearch } from './search/useSearch'

export function SearchPage({ includeH1 = true }: { includeH1?: boolean }) {
  const location = useLocation()
  const search = useSearch()
  const [termOptions, setTermOptions] = useState<SearchTermOptionsDto | null>(
    null
  )
  const [termOptionsError, setTermOptionsError] = useState(false)
  const [termOptionsAttempt, setTermOptionsAttempt] = useState(0)

  useEffect(() => {
    document.title = search.meta
      ? `${search.resultsHeadingLabel} · Course Warlock v2 Beta`
      : 'Course Warlock v2 Beta'
  }, [search.meta, search.resultsHeadingLabel])

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

  return (
    <PageContainer className="py-4 sm:py-6">
      {includeH1 && <h1 className="sr-only">Course Warlock v2 Beta</h1>}
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <SearchForm
          query={search.query}
          showFirstRunExamples={search.showExamples}
          onQueryChange={search.setQuery}
          onSubmit={search.submit}
          onExampleSearch={search.search}
        />

        <SearchMessages search={search} />

        <RefinePanel
          meta={search.meta}
          resultCountLabel={search.resultCountLabel}
          availableTerms={termOptions?.terms}
          termOptionsError={termOptionsError}
          termOptionsLoading={!termOptions && !termOptionsError}
          advancedDraftErrors={search.advancedErrors}
          hasAdvancedDraftErrors={search.hasAdvancedErrors}
          advancedOpen={search.advancedOpen}
          advancedDraft={search.advancedDraft}
          hasAdvancedDraftChanges={search.hasAdvancedChanges}
          onAdvancedOpenChange={search.setAdvancedOpen}
          onAdvancedDraftFilterChange={search.updateAdvancedFilter}
          onAdvancedDraftScopeChange={search.updateAdvancedScope}
          onRemoveChip={search.removeChip}
          onAmbiguityAction={search.applyAmbiguity}
          onApplyAdvancedSearch={search.applyAdvanced}
          onResetAdvancedDraft={search.resetAdvanced}
          onRetryTermOptions={() => {
            setTermOptions(null)
            setTermOptionsError(false)
            setTermOptionsAttempt((attempt) => attempt + 1)
          }}
        />

        <ResultsList
          meta={search.meta}
          results={search.results}
          pagination={search.pagination}
          loading={search.loading}
          loadingMore={search.loadingMore}
          sort={search.sort}
          resultViewMode={search.view}
          showInitialSkeleton={search.showSkeleton}
          isRefreshingResults={search.refreshing}
          resultsHeadingLabel={search.resultsHeadingLabel}
          showingResultsLabel={search.showingResultsLabel}
          feedbackAction={<SearchFeedback search={search} />}
          onSortFieldChange={search.setSortField}
          onDirectionToggle={search.toggleSortDirection}
          onViewChange={search.setView}
          onTableSort={search.tableSort}
          onRemoveChip={search.removeChip}
          onLoadMore={search.loadMore}
          returnTo={`${location.pathname}${location.search}`}
        />
      </div>
    </PageContainer>
  )
}

type Search = ReturnType<typeof useSearch>

function SearchMessages({ search }: { search: Search }) {
  return <>
    {search.urlError && <Alert variant="destructive">
      <AlertCircleIcon aria-hidden /><AlertTitle>That search link is not valid</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{search.urlError}</span>
        <button type="button" className="min-h-8 font-medium underline" onClick={search.resetBrokenUrl}>Start a new search</button>
      </AlertDescription>
    </Alert>}
    {search.error && <Alert variant="destructive">
      <AlertCircleIcon aria-hidden /><AlertTitle>That search did not go through</AlertTitle>
      <AlertDescription>{search.error}</AlertDescription>
    </Alert>}
  </>
}

function SearchFeedback({ search }: { search: Search }) {
  if (!search.meta) return null
  return <FeedbackButton
    buttonLabel="Results not right?" page="search" buttonVariant="outline"
    context={{
      query: search.meta.nextRequest.query,
      metadata: {
        resultCount: search.pagination?.totalResults ?? search.results.length,
        hasMore: search.pagination?.hasMore === true,
        typedQuery: search.query.trim() || null,
        effectiveQuery: search.activeRequest?.query || null,
      },
    }}
  />
}
