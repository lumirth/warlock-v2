import type { SearchControllerState } from './search-controller-state'
import type { ExecuteSearch } from './useSearchExecution'

export function useSearchPagination({
  state,
  executeSearch,
}: {
  state: SearchControllerState
  executeSearch: ExecuteSearch
}) {
  const loadMoreResults = () => {
    if (!state.session.pagination?.hasMore || !state.session.activeRequest) {
      return
    }
    const nextOffset =
      state.session.pagination.nextOffset ??
      state.session.pagination.offset + state.session.pagination.limit

    executeSearch({
      type: 'request',
      mode: 'append',
      request: state.session.activeRequest,
      offset: nextOffset,
      sort: state.session.sort,
    })
  }

  return { loadMoreResults }
}
