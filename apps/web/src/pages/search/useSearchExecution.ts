import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
} from 'react'
import { api } from '../../lib/api-client'
import type { SearchSort } from '@uiuc-course-search/query-types'
import type { SearchRequestDto } from '@uiuc-course-search/query-types'
import { resolveSearchCommand, type SearchCommand } from './search-command'
import type {
  SearchControllerAction,
  SearchExecutionMode,
} from './search-controller-state'

type ExecuteSearch = (command: SearchCommand) => void

export function useSearchExecution({
  dispatch,
  currentSort,
  onRequestChange,
}: {
  dispatch: Dispatch<SearchControllerAction>
  currentSort: SearchSort
  onRequestChange?: (
    request: SearchRequestDto,
    mode: SearchExecutionMode
  ) => void
}): { executeSearch: ExecuteSearch; cancelSearch: () => void } {
  const searchController = useRef<AbortController | null>(null)

  const cancelSearch = useCallback(() => {
    const controller = searchController.current
    searchController.current = null
    controller?.abort()
  }, [])

  useEffect(() => cancelSearch, [cancelSearch])

  const executeSearch = useCallback<ExecuteSearch>(
    (command) => {
      void runSearch({
        dispatch,
        currentSort,
        searchController,
        command,
        onRequestChange,
      })
    },
    [currentSort, dispatch, onRequestChange]
  )

  return { executeSearch, cancelSearch }
}

async function runSearch({
  dispatch,
  currentSort,
  searchController,
  command,
  onRequestChange,
}: {
  dispatch: Dispatch<SearchControllerAction>
  currentSort: SearchSort
  searchController: MutableRefObject<AbortController | null>
  command: SearchCommand
  onRequestChange?: (
    request: SearchRequestDto,
    mode: SearchExecutionMode
  ) => void
}) {
  let resolved: ReturnType<typeof resolveSearchCommand>
  try {
    resolved = resolveSearchCommand(command, currentSort)
  } catch {
    dispatch({
      type: 'search/failed',
      message: 'Check the highlighted filters and try again.',
      mode: command.type === 'request' ? command.mode : 'refine',
    })
    return
  }
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
    const data = await api.search(resolved.request, {
      signal: controller.signal,
    })
    if (searchController.current !== controller) return
    dispatch({
      type: 'search/succeeded',
      response: data,
      mode: resolved.mode,
      requestSort: resolved.sort,
    })
    onRequestChange?.(resolved.request, resolved.mode)
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
