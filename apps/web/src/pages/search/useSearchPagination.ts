import type { SearchControllerState } from './search-controller-state'
import type { SearchViewModel } from './search-view-model'
import type { ExecuteSearch } from './useSearchExecution'

export function useSearchPagination({
  state,
  derived,
  executeSearch,
}: {
  state: SearchControllerState
  derived: SearchViewModel
  executeSearch: ExecuteSearch
}) {
  const loadMoreResults = () => {
    if (!state.session.pagination?.hasMore) {
      return
    }
    const nextOffset =
      state.session.pagination.nextOffset ??
      state.session.pagination.offset + state.session.pagination.limit

    executeSearch({
      type: 'append',
      query: derived.activeRequestQuery,
      offset: nextOffset,
      filters: derived.activeAdvancedFilters,
      sort: state.session.sort,
    })
  }

  return { loadMoreResults }
}
