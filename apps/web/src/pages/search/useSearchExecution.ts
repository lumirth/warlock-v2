import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
} from 'react'
import { api } from '../../lib/api-client'
import type { SearchSort } from '@uiuc-course-search/query-types'
import {
  resolveSearchCommand,
  type SearchCommand,
} from './search-command'
import type {
  SearchControllerAction,
} from './search-controller-state'

type ExecuteSearch = (command: SearchCommand) => void

export function useSearchExecution({
  dispatch,
  currentSort,
}: {
  dispatch: Dispatch<SearchControllerAction>
  currentSort: SearchSort
}): { executeSearch: ExecuteSearch } {
  const searchController = useRef<AbortController | null>(null)

  const executeSearch = useCallback<ExecuteSearch>(
    (command) => {
      void runSearch({
        dispatch,
        currentSort,
        searchController,
        command,
      })
    },
    [currentSort, dispatch]
  )

  return { executeSearch }
}

async function runSearch({
  dispatch,
  currentSort,
  searchController,
  command,
}: {
  dispatch: Dispatch<SearchControllerAction>
  currentSort: SearchSort
  searchController: MutableRefObject<AbortController | null>
  command: SearchCommand
}) {
  const resolved = resolveSearchCommand(command, currentSort)
  if (!resolved) return

  if (searchController.current) {
    searchController.current.abort()
  }
  const controller = new AbortController()
  searchController.current = controller

  dispatch({
    type: 'search/started',
    request: resolved.request,
    mode: resolved.mode,
    sort: resolved.sort,
  })

  try {
    const data = await api.search(resolved.request, { signal: controller.signal })
    if (searchController.current !== controller) return
    dispatch({
      type: 'search/succeeded',
      response: data,
      mode: resolved.mode,
      requestSort: resolved.sort,
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return
    if (searchController.current !== controller) return
    dispatch({
      type: 'search/failed',
      message: 'Give it another moment, or try a broader search.',
      mode: resolved.mode,
    })
  } finally {
    if (searchController.current === controller) {
      dispatch({ type: 'search/finished' })
      searchController.current = null
    }
  }
}
