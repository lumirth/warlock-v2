import type {
  AdvancedSearchStateDto,
  SearchCourseResultDto,
  SearchResponseDto,
  SearchSort,
} from '@uiuc-course-search/query-types'
import { DEFAULT_SEARCH_SORT } from './search-sort-model'
import type { ResultViewMode } from './search-sort-model'
import type { SearchPagination } from './search-types'

export type SearchExecutionMode = 'replace' | 'refine' | 'append' | 'refresh'

export type SearchDraftState = {
  query: string
  inputDirty: boolean
  advancedOpen: boolean
  advancedDraft: AdvancedSearchStateDto
  resultViewMode: ResultViewMode
}

export type SearchSessionState = {
  activeSearchText: string
  activeAdvancedFilters: AdvancedSearchStateDto
  results: SearchCourseResultDto[]
  meta: SearchResponseDto['meta'] | null
  pagination: SearchPagination | null
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
      type: 'advanced/draft-field-changed'
      key: keyof AdvancedSearchStateDto
      value: AdvancedSearchStateDto[keyof AdvancedSearchStateDto]
    }
  | { type: 'advanced/draft-replaced'; value: AdvancedSearchStateDto }
  | { type: 'result-view/changed'; value: ResultViewMode }
  | {
      type: 'search/started'
      query: string
      filters: AdvancedSearchStateDto
      mode: SearchExecutionMode
      sort: SearchSort
    }
  | {
      type: 'search/succeeded'
      response: SearchResponseDto
      mode: SearchExecutionMode
      requestSort: SearchSort
    }
  | { type: 'search/failed'; message: string }
  | { type: 'search/finished' }
  | { type: 'search/cleared' }

export const INITIAL_SEARCH_DRAFT_STATE: SearchDraftState = {
  query: '',
  inputDirty: false,
  advancedOpen: false,
  advancedDraft: {},
  resultViewMode: 'cards',
}

export const INITIAL_SEARCH_SESSION_STATE: SearchSessionState = {
  activeSearchText: '',
  activeAdvancedFilters: {},
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
    case 'advanced/draft-field-changed':
      return updateDraft(state, {
        advancedDraft: {
          ...state.draft.advancedDraft,
          [action.key]: action.value,
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
        results:
          action.mode === 'append'
            ? [...state.session.results, ...(action.response.results || [])]
            : action.response.results || [],
        meta: action.response.meta || null,
        pagination: action.response.pagination || null,
        sort:
          action.mode === 'append'
            ? state.session.sort
            : action.response.meta?.appliedSort ?? action.requestSort,
      })
    case 'search/failed':
      return updateSession(state, {
        error: action.message,
        meta: null,
        results: [],
        pagination: null,
      })
    case 'search/finished':
      return updateSession(state, { loading: false, loadingMore: false })
    case 'search/cleared':
      return {
        draft: {
          ...state.draft,
          advancedDraft: {},
        },
        session: {
          ...state.session,
          activeSearchText: '',
          activeAdvancedFilters: {},
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
    nextState = updateDraft(nextState, { query: action.query })
  }

  if (!isAppend) {
    nextState = updateDraft(nextState, { inputDirty: false })
    nextState = updateSession(nextState, {
      activeSearchText: action.query,
      activeAdvancedFilters: action.filters,
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
