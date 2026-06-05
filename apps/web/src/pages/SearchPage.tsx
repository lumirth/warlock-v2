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

        {state.session.meta && (
          <RefinePanel
            meta={state.session.meta}
            resultCountLabel={derived.resultCountLabel}
            advancedOpen={state.draft.advancedOpen}
            advancedDraft={state.draft.advancedDraft}
            hasAdvancedDraftChanges={derived.hasAdvancedDraftChanges}
            onAdvancedOpenChange={actions.setAdvancedOpen}
            onAdvancedDraftChange={actions.updateAdvancedDraft}
            onRemoveChip={actions.removeChip}
            onAmbiguityAction={actions.applyAmbiguityAction}
            onApplyAdvancedSearch={actions.applyAdvancedSearch}
            onResetAdvancedDraft={actions.resetAdvancedDraft}
          />
        )}

        {state.session.meta && (
          <div>
            <FeedbackButton
              buttonLabel="Results not right?"
              page="search"
              kind="search_results"
              issue="expected_different_results"
              fullWidth
              context={{
                query: state.session.meta.query.raw,
                metadata: {
                  resultCount: state.session.results.length,
                  hasMore: state.session.pagination?.hasMore === true,
                  typedQuery: state.draft.query.trim() || null,
                  effectiveQuery: derived.activeRequestQuery || null,
                },
              }}
            />
          </div>
        )}

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
