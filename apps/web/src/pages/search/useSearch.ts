import {
  DEFAULT_SEARCH_SORT,
  SEARCH_PAGINATION_DEFAULT_LIMIT,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  normalizeSearchPaginationDto,
  normalizeSearchRequestDto,
  searchRequestHasFilters,
  splitAdvancedSearchState,
  type AdvancedSearchStateDto,
  type SearchAmbiguityActionDto,
  type SearchChipDto,
  type SearchRequestDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchResponseDto,
  type SearchScope,
  type SortField,
} from '@uiuc-course-search/query-types'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api-client'
import {
  advancedFiltersChanged,
  advancedStateFromRequest,
  hasAdvancedFilterValue,
  validateAdvancedFilters,
} from './search-filter-model'
import {
  readSearchUrlState,
  writeResultViewToSearch,
  writeSearchUrlState,
} from './search-url-state'
import {
  nextSortForField,
  normalizeSearchSort,
  readStoredResultViewMode,
  writeStoredResultViewMode,
  type ResultViewMode,
} from './search-sort-model'

type SearchMode = 'replace' | 'refine' | 'refresh' | 'append'

function advancedFor(request: SearchRequestDto | null | undefined): AdvancedSearchStateDto {
  return request ? advancedStateFromRequest(request) : { filters: {} }
}

function normalizeForRun(raw: SearchRequestDto): SearchRequestDto | null {
  try {
    return { ...normalizeSearchRequestDto(raw), pagination: normalizeSearchPaginationDto(raw.pagination) }
  } catch {
    return null
  }
}

function modeFlags(mode: SearchMode) {
  return {
    appending: mode === 'append',
    clearBeforeRun: mode === 'replace' || mode === 'refine',
    clearAfterFailure: mode === 'replace' || mode === 'refine',
  }
}

function activeRequestFor(response: SearchResponseDto | null, urlRequest: SearchRequestDto | null) {
  if (!response) return urlRequest
  return {
    ...response.meta.nextRequest,
    sort: urlRequest?.sort ?? response.meta.nextRequest.sort,
  }
}

function responseParts(response: SearchResponseDto | null) {
  return response
    ? { results: response.results, pagination: response.pagination, meta: response.meta }
    : { results: [], pagination: null, meta: null }
}

function resultLabels(total: number, browseable: number, shown: number, degraded: boolean) {
  const qualifiedTotal = `${degraded ? 'at least ' : ''}${total.toLocaleString()}`
  const resultCountLabel = `${degraded ? 'At least ' : ''}${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`
  let showingResultsLabel = `Showing ${shown.toLocaleString()}`
  if (total > browseable && shown >= browseable) showingResultsLabel = `Showing top ${browseable.toLocaleString()} of ${qualifiedTotal}`
  else if (degraded || total > shown) showingResultsLabel += ` of ${qualifiedTotal}`
  return { resultCountLabel, showingResultsLabel }
}

function summarizeResults(
  results: SearchResponseDto['results'],
  pagination: SearchResponseDto['pagination'] | null,
  meta: SearchResponseDto['meta'] | null
) {
  const total = pagination?.totalResults ?? results.length
  const browseable = pagination?.browseableResults ?? total
  const degraded = meta?.retrieval?.degraded === true
  return resultLabels(total, browseable, results.length, degraded)
}

function deriveResults(response: SearchResponseDto | null, urlRequest: SearchRequestDto | null) {
  const activeRequest = activeRequestFor(response, urlRequest)
  const interpretedRequest = response ? response.meta.interpretedRequest : activeRequest
  const activeAdvanced = advancedFor(interpretedRequest)
  const sort = normalizeSearchSort(activeRequest?.sort ?? DEFAULT_SEARCH_SORT)
  const { results, pagination, meta } = responseParts(response)
  return {
    activeRequest, interpretedRequest, activeAdvanced, sort, results, pagination, meta,
    ...summarizeResults(results, pagination, meta),
  }
}

function displayFlags(
  response: SearchResponseDto | null,
  loading: boolean,
  activeRequest: SearchRequestDto | null,
  error: string | null,
  meta: SearchResponseDto['meta'] | null,
  activeAdvanced: AdvancedSearchStateDto,
  advancedDraft: AdvancedSearchStateDto
) {
  const refreshing = loading && Boolean(response)
  return {
    resultsHeadingLabel: meta?.nextRequest.query ? `Results for ${meta.nextRequest.query}` : 'Results matching filters',
    hasAdvancedChanges: response
      ? advancedFiltersChanged(activeAdvanced, advancedDraft)
      : hasAdvancedFilterValue(advancedDraft),
    showExamples: ![response, loading, activeRequest, error].some(Boolean),
    refreshing,
    showSkeleton: loading && !refreshing,
  }
}

export function useSearch() {
  const location = useLocation()
  const navigate = useNavigate()
  const url = useMemo(
    () => readSearchUrlState(new URLSearchParams(location.search)),
    [location.search]
  )
  const requestKey = useMemo(() => {
    const params = new URLSearchParams(location.search)
    params.delete('view')
    return params.toString()
  }, [location.search])
  const [query, setQueryState] = useState(url.request?.query ?? '')
  const [queryDirty, setQueryDirty] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedSearchStateDto>(
    () => advancedFor(url.request)
  )
  const [storedView, setStoredView] = useState(readStoredResultViewMode)
  const view = url.view ?? storedView
  const [response, setResponse] = useState<SearchResponseDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const pendingMode = useRef<{ key: string; mode: SearchMode } | null>(null)

  const cancel = useCallback(() => {
    controller.current?.abort()
    controller.current = null
  }, [])

  const run = useCallback(
    async (rawRequest: SearchRequestDto, mode: SearchMode) => {
      const request = normalizeForRun(rawRequest)
      if (!request) {
        setError('Check the highlighted filters and try again.')
        return
      }
      const flags = modeFlags(mode)
      cancel()
      const nextController = new AbortController()
      controller.current = nextController
      setError(null)
      setLoadingMore(flags.appending)
      setLoading(!flags.appending)
      if (flags.clearBeforeRun) setResponse(null)

      try {
        const next = await api.search(request, {
          signal: nextController.signal,
        })
        if (controller.current !== nextController) return
        setResponse((previous) =>
          mode === 'append' && previous
            ? { ...next, results: [...previous.results, ...next.results] }
            : next
        )
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError' || controller.current !== nextController) return
        setError('Give it another moment, or try a broader search.')
        if (flags.clearAfterFailure) setResponse(null)
      } finally {
        if (controller.current === nextController) {
          controller.current = null
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [cancel]
  )

  useEffect(() => cancel, [cancel])

  useEffect(() => {
    const pending = pendingMode.current
    const mode = pending?.key === requestKey ? pending.mode : 'replace'
    pendingMode.current = null

    if (!url.request || url.error) {
      cancel()
      // The router is an external state source; an empty URL clears its view.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResponse(null)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      setQueryState('')
      setQueryDirty(false)
      setAdvancedDraft({ filters: {} })
      return
    }

    // Sort refreshes change the committed URL but must not overwrite a draft
    // the user is still editing.
    if (mode !== 'refresh') {
      setQueryState(url.request.query)
      setQueryDirty(false)
      setAdvancedDraft(advancedStateFromRequest(url.request))
    }
    void run(url.request, mode)
    // requestKey represents every URL field that can affect the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, cancel, run])

  const go = useCallback(
    (rawRequest: SearchRequestDto, mode: Exclude<SearchMode, 'append'>) => {
      let request: SearchRequestDto
      try {
        const normalized = normalizeSearchRequestDto(rawRequest)
        request = {
          ...normalized,
          pagination: {
            limit:
              rawRequest.pagination?.limit ?? SEARCH_PAGINATION_DEFAULT_LIMIT,
            offset: 0,
          },
        }
      } catch {
        setError('Check the highlighted filters and try again.')
        return
      }

      const hasSearch =
        request.query.trim().length > 0 ||
        searchRequestHasFilters({ filters: request.filters ?? {} })
      if (!hasSearch) {
        pendingMode.current = null
        navigate({ pathname: '/', search: '' })
        return
      }

      const search = writeSearchUrlState(request, view)
      const params = new URLSearchParams(search)
      params.delete('view')
      const key = params.toString()
      if (key === requestKey) {
        void run(request, mode)
        return
      }
      pendingMode.current = { key, mode }
      navigate({ pathname: '/', search }, { replace: mode === 'refresh' })
    },
    [navigate, requestKey, run, view]
  )

  const derived = deriveResults(response, url.request)
  const { activeRequest, interpretedRequest, activeAdvanced, sort, results, pagination, meta } = derived
  const validation = validateAdvancedFilters(advancedDraft)
  const display = displayFlags(response, loading, activeRequest, error, meta, activeAdvanced, advancedDraft)

  const search = (nextQuery: string) =>
    go(
      {
        query: nextQuery.trim(),
        sort,
        pagination: { limit: SEARCH_PAGINATION_DEFAULT_LIMIT, offset: 0 },
      },
      'replace'
    )

  const refine = (request: SearchRequestDto) => go(request, 'refine')

  return {
    query,
    setQuery(value: string) {
      setQueryState(value)
      setQueryDirty(true)
    },
    advancedOpen,
    setAdvancedOpen,
    advancedDraft,
    updateAdvancedFilter<Key extends SearchRequestFilterKey>(
      key: Key,
      value: SearchRequestFiltersDto[Key]
    ) {
      setAdvancedDraft((draft) => ({
        ...draft,
        filters: { ...draft.filters, [key]: value },
      }))
    },
    updateAdvancedScope(value?: SearchScope) {
      setAdvancedDraft((draft) => ({ ...draft, scope: value }))
    },
    applyAdvanced() {
      if (!validation.ok) {
        setAdvancedOpen(true)
        return
      }
      const { filters, scope } = splitAdvancedSearchState(validation.value)
      const appliedQuery = queryDirty
        ? query.trim()
        : (interpretedRequest?.query ?? query).trim()
      setAdvancedOpen(false)
      go({ query: appliedQuery, filters, scope, sort }, 'refine')
    },
    resetAdvanced() {
      setAdvancedDraft(activeAdvanced)
    },
    submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      search(query)
    },
    search,
    removeChip(chip: SearchChipDto) {
      refine(chip.removeRequest)
    },
    applyAmbiguity(action: SearchAmbiguityActionDto) {
      refine(action.nextRequest)
    },
    clear() {
      pendingMode.current = null
      navigate({ pathname: '/', search: '' })
    },
    setSortField(field: SortField) {
      if (!activeRequest) return
      go(
        {
          ...activeRequest,
          sort: { field, direction: SEARCH_SORT_DEFAULT_DIRECTIONS[field] },
        },
        'refresh'
      )
    },
    toggleSortDirection() {
      if (!activeRequest || sort.field === 'relevance') return
      go(
        {
          ...activeRequest,
          sort: {
            field: sort.field,
            direction: sort.direction === 'asc' ? 'desc' : 'asc',
          },
        },
        'refresh'
      )
    },
    tableSort(field: Exclude<SortField, 'relevance'>) {
      if (!activeRequest) return
      go({ ...activeRequest, sort: nextSortForField(field, sort) }, 'refresh')
    },
    loadMore() {
      if (!activeRequest || !pagination?.hasMore) return
      void run(
        {
          ...activeRequest,
          sort,
          pagination: {
            limit: pagination.limit,
            offset: pagination.offset + pagination.limit,
          },
        },
        'append'
      )
    },
    view,
    setView(next: ResultViewMode) {
      setStoredView(next)
      writeStoredResultViewMode(next)
      const search = writeResultViewToSearch(location.search, next)
      navigate({ pathname: '/', search }, { replace: true })
    },
    urlError: url.error,
    resetBrokenUrl() {
      navigate({ pathname: '/', search: '' })
    },
    response,
    results,
    pagination,
    meta,
    error,
    loading,
    loadingMore,
    sort,
    activeRequest,
    resultCountLabel: derived.resultCountLabel,
    showingResultsLabel: derived.showingResultsLabel,
    resultsHeadingLabel: display.resultsHeadingLabel,
    advancedErrors: validation.errors,
    hasAdvancedErrors: !validation.ok,
    hasAdvancedChanges: display.hasAdvancedChanges,
    showExamples: display.showExamples,
    refreshing: display.refreshing,
    showSkeleton: display.showSkeleton,
  }
}
