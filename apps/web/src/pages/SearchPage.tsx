import { AlertCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SearchTermOptionsDto } from '@uiuc-course-search/query-types'
import { FeedbackButton } from '../components/FeedbackButton'
import { PageContainer } from '@/components/PageContainer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { api } from '../lib/api-client'
import { RefinePanel } from './search/RefinePanel'
import { ResultsList } from './search/ResultsList'
import { SearchForm } from './search/SearchForm'
import { useSearchController } from './search/useSearchController'

export function SearchPage({ includeH1 = true }: { includeH1?: boolean }) {
  const { state, derived, actions } = useSearchController()
  const [termOptions, setTermOptions] = useState<SearchTermOptionsDto | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    api.getTermOptions(controller.signal)
      .then(setTermOptions)
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') {
          setTermOptions({ terms: [], years: [] })
        }
      })

    return () => controller.abort()
  }, [])

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
          availableYears={termOptions?.years}
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
          recoveryGroups={derived.recoveryGroups}
          feedbackAction={
            state.session.meta ? (
              <FeedbackButton
                buttonLabel="Results not right?"
                page="search"
                kind="search_results"
                issue="expected_different_results"
                buttonVariant="outline"
                context={{
                  query: state.session.meta.query.raw,
                  metadata: {
                    resultCount: state.session.pagination?.totalResults ?? state.session.results.length,
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
          onViewChange={actions.setResultViewMode}
          onTableSort={actions.handleTableSort}
          onRemoveChip={actions.removeChip}
          onApplyRecoveryGroup={actions.applyRecoveryGroup}
          onLoadMore={actions.loadMoreResults}
        />
      </div>
    </PageContainer>
  )
}
