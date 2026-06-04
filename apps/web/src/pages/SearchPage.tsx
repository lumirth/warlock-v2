import { AlertCircleIcon } from 'lucide-react'
import { FeedbackButton } from '../components/FeedbackButton'
import { PageContainer } from '@/components/PageContainer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { RefinePanel } from './search/RefinePanel'
import { ResultsList } from './search/ResultsList'
import { SearchForm } from './search/SearchForm'
import { useSearchController } from './search/useSearchController'

export function SearchPage({ includeH1 = true }: { includeH1?: boolean }) {
  const { state, derived, actions } = useSearchController()

  return (
    <PageContainer className="py-4 sm:py-6">
      {includeH1 && <h1 className="sr-only">UIUC Course Search</h1>}
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <SearchForm
          query={state.query}
          showFirstRunExamples={derived.showFirstRunExamples}
          onQueryChange={actions.setQuery}
          onSubmit={actions.handleSearchSubmit}
          onExampleSearch={actions.runExampleSearch}
        />

        {state.error && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertTitle>That search did not go through</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        {state.meta && (
          <RefinePanel
            meta={state.meta}
            resultCountLabel={derived.resultCountLabel}
            advancedOpen={state.advancedOpen}
            advancedDraft={state.advancedDraft}
            hasAdvancedDraftChanges={derived.hasAdvancedDraftChanges}
            onAdvancedOpenChange={actions.setAdvancedOpen}
            onAdvancedDraftChange={actions.updateAdvancedDraft}
            onRemoveChip={actions.removeChip}
            onAmbiguityAction={actions.applyAmbiguityAction}
            onApplyAdvancedSearch={actions.applyAdvancedSearch}
            onResetAdvancedDraft={actions.resetAdvancedDraft}
          />
        )}

        {state.meta && (
          <div>
            <FeedbackButton
              buttonLabel="Results not right?"
              page="search"
              kind="search_results"
              issue="expected_different_results"
              fullWidth
              context={{
                query: state.meta.query.raw,
                metadata: {
                  resultCount: state.results.length,
                  hasMore: state.pagination?.hasMore === true,
                  typedQuery: state.query.trim() || null,
                  effectiveQuery: derived.activeRequestQuery || null,
                },
              }}
            />
          </div>
        )}

        <ResultsList
          meta={state.meta}
          results={state.results}
          pagination={state.pagination}
          loading={state.loading}
          loadingMore={state.loadingMore}
          sort={state.sort}
          resultViewMode={state.resultViewMode}
          showInitialSkeleton={derived.showInitialSkeleton}
          isRefreshingResults={derived.isRefreshingResults}
          resultsHeadingLabel={derived.resultsHeadingLabel}
          showingResultsLabel={derived.showingResultsLabel}
          recoveryGroups={derived.recoveryGroups}
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
