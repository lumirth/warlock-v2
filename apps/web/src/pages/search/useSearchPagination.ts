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
    if (!state.pagination?.hasMore) {
      return
    }
    const nextOffset =
      state.pagination.nextOffset ??
      state.pagination.offset + state.pagination.limit

    executeSearch(derived.activeRequestQuery, {
      offset: nextOffset,
      mode: 'append',
      filters: state.activeAdvancedFilters,
      sort: state.sort,
    })
  }

  return { loadMoreResults }
}
