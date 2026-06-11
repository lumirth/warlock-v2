import type {
  AdvancedSearchStateDto,
  SearchCourseResultDto,
  SearchRequestFilterKey,
  SearchRequestFiltersDto,
  SearchRequestDto,
  SearchResponseDto,
  SearchScope,
  SearchSort,
} from '@uiuc-course-search/query-types'
import { DEFAULT_SEARCH_SORT } from '@uiuc-course-search/query-types'
import type { ResultViewMode } from './search-sort-model'

export type SearchExecutionMode = 'replace' | 'refine' | 'append' | 'refresh'

type SearchDraftState = {
  query: string
  inputDirty: boolean
  advancedOpen: boolean
  advancedDraft: AdvancedSearchStateDto
  resultViewMode: ResultViewMode
}

type SearchSessionState = {
  activeRequest: SearchRequestDto | null
  results: SearchCourseResultDto[]
  meta: SearchResponseDto['meta'] | null
  pagination: SearchResponseDto['pagination'] | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  sort: SearchSort
}

export type SearchControllerState = {
  draft: SearchDraftState
  session: SearchSessionState
}

export type SearchControllerAction =
  | { type: 'query/changed'; value: string }
  | { type: 'advanced/open-changed'; value: boolean }
  | {
      type: 'advanced/draft-filter-changed'
      key: SearchRequestFilterKey
      value: SearchRequestFiltersDto[SearchRequestFilterKey]
    }
  | { type: 'advanced/draft-scope-changed'; value?: SearchScope }
  | { type: 'advanced/draft-replaced'; value: AdvancedSearchStateDto }
  | { type: 'result-view/changed'; value: ResultViewMode }
  | {
      type: 'search/started'
      request: SearchRequestDto
      mode: SearchExecutionMode
      sort: SearchSort
    }
  | {
      type: 'search/succeeded'
      response: SearchResponseDto
      mode: SearchExecutionMode
      requestSort: SearchSort
    }
  | {
      type: 'search/failed'
      message: string
      mode: SearchExecutionMode
    }
  | { type: 'search/finished' }
  | { type: 'search/cleared' }

const INITIAL_SEARCH_DRAFT_STATE: SearchDraftState = {
  query: '',
  inputDirty: false,
  advancedOpen: false,
  advancedDraft: { filters: {} },
  resultViewMode: 'cards',
}

const INITIAL_SEARCH_SESSION_STATE: SearchSessionState = {
  activeRequest: null,
  results: [],
  meta: null,
  pagination: null,
  loading: false,
  loadingMore: false,
  error: null,
  sort: DEFAULT_SEARCH_SORT,
}

export const INITIAL_SEARCH_CONTROLLER_STATE: SearchControllerState = {
  draft: INITIAL_SEARCH_DRAFT_STATE,
  session: INITIAL_SEARCH_SESSION_STATE,
}

export function searchControllerReducer(
  state: SearchControllerState,
  action: SearchControllerAction
): SearchControllerState {
  switch (action.type) {
    case 'query/changed':
      return updateDraft(state, { query: action.value, inputDirty: true })
    case 'advanced/open-changed':
      return updateDraft(state, { advancedOpen: action.value })
    case 'advanced/draft-filter-changed':
      return updateDraft(state, {
        advancedDraft: {
          ...state.draft.advancedDraft,
          filters: {
            ...state.draft.advancedDraft.filters,
            [action.key]: action.value,
          },
        },
      })
    case 'advanced/draft-scope-changed':
      return updateDraft(state, {
        advancedDraft: {
          ...state.draft.advancedDraft,
          scope: action.value,
        },
      })
    case 'advanced/draft-replaced':
      return updateDraft(state, { advancedDraft: action.value })
    case 'result-view/changed':
      return updateDraft(state, { resultViewMode: action.value })
    case 'search/started':
      return searchStartedState(state, action)
    case 'search/succeeded':
      return updateSession(state, {
        activeRequest:
          action.mode === 'append'
            ? state.session.activeRequest
            : activeRequestFromResponse(action.response),
        results:
          action.mode === 'append'
            ? [...state.session.results, ...action.response.results]
            : action.response.results,
        meta: action.response.meta,
        pagination: action.response.pagination,
        sort:
          action.mode === 'append'
            ? state.session.sort
            : action.response.meta.nextRequest.sort ?? action.requestSort,
      })
    case 'search/failed':
      return updateSession(
        state,
        action.mode === 'append' || action.mode === 'refresh'
          ? { error: action.message }
          : {
              error: action.message,
              meta: null,
              results: [],
              pagination: null,
            }
      )
    case 'search/finished':
      return updateSession(state, { loading: false, loadingMore: false })
    case 'search/cleared':
      return {
        draft: {
          ...state.draft,
          query: '',
          inputDirty: false,
          advancedDraft: { filters: {} },
        },
        session: {
          ...state.session,
          activeRequest: null,
          results: [],
          meta: null,
          pagination: null,
          error: null,
          loading: false,
          loadingMore: false,
        },
      }
  }
}

function searchStartedState(
  state: SearchControllerState,
  action: Extract<SearchControllerAction, { type: 'search/started' }>
): SearchControllerState {
  const isAppend = action.mode === 'append'
  const isRefresh = action.mode === 'refresh'

  let nextState = updateSession(state, {
    error: null,
    loading: !isAppend,
    loadingMore: isAppend,
    sort: action.sort,
  })

  if (action.mode === 'replace') {
    nextState = updateDraft(nextState, { query: action.request.query })
  }

  if (!isAppend) {
    nextState = updateDraft(nextState, { inputDirty: false })
    nextState = updateSession(nextState, {
      activeRequest: withoutPaginationOffset(action.request),
    })
  }

  if (!isAppend && !isRefresh) {
    nextState = updateSession(nextState, {
      meta: null,
      results: [],
      pagination: null,
    })
  }

  return nextState
}

function withoutPaginationOffset(request: SearchRequestDto): SearchRequestDto {
  return {
    ...request,
    pagination: request.pagination
      ? {
          ...request.pagination,
          offset: 0,
        }
      : undefined,
  }
}

function activeRequestFromResponse(
  response: SearchResponseDto
): SearchRequestDto {
  return {
    ...response.meta.nextRequest,
    pagination: {
      limit: response.pagination.limit,
      offset: 0,
    },
  }
}

function updateDraft(
  state: SearchControllerState,
  patch: Partial<SearchDraftState>
): SearchControllerState {
  return {
    ...state,
    draft: {
      ...state.draft,
      ...patch,
    },
  }
}

function updateSession(
  state: SearchControllerState,
  patch: Partial<SearchSessionState>
): SearchControllerState {
  return {
    ...state,
    session: {
      ...state.session,
      ...patch,
    },
  }
}
