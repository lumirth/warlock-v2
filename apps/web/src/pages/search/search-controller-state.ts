import type {
  AdvancedSearchStateDto,
  CourseDto,
  SearchResponseDto,
  SearchSort,
} from '@uiuc-course-search/query-types'
import { DEFAULT_SEARCH_SORT } from './search-sort-model'
import type { ResultViewMode } from './search-sort-model'
import type { SearchPagination } from './search-types'

export type SearchExecutionMode = 'replace' | 'refine' | 'append' | 'refresh'

export type SearchControllerState = {
  query: string
  inputDirty: boolean
  activeSearchText: string
  activeAdvancedFilters: AdvancedSearchStateDto
  results: CourseDto[]
  meta: SearchResponseDto['meta'] | null
  pagination: SearchPagination | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  advancedOpen: boolean
  advancedDraft: AdvancedSearchStateDto
  sort: SearchSort
  resultViewMode: ResultViewMode
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

export const INITIAL_SEARCH_CONTROLLER_STATE: SearchControllerState = {
  query: '',
  inputDirty: false,
  activeSearchText: '',
  activeAdvancedFilters: {},
  results: [],
  meta: null,
  pagination: null,
  loading: false,
  loadingMore: false,
  error: null,
  advancedOpen: false,
  advancedDraft: {},
  sort: DEFAULT_SEARCH_SORT,
  resultViewMode: 'cards',
}

export function searchControllerReducer(
  state: SearchControllerState,
  action: SearchControllerAction
): SearchControllerState {
  switch (action.type) {
    case 'query/changed':
      return { ...state, query: action.value, inputDirty: true }
    case 'advanced/open-changed':
      return { ...state, advancedOpen: action.value }
    case 'advanced/draft-field-changed':
      return {
        ...state,
        advancedDraft: {
          ...state.advancedDraft,
          [action.key]: action.value,
        },
      }
    case 'advanced/draft-replaced':
      return { ...state, advancedDraft: action.value }
    case 'result-view/changed':
      return { ...state, resultViewMode: action.value }
    case 'search/started': {
      const isAppend = action.mode === 'append'
      const isRefresh = action.mode === 'refresh'
      const nextState: SearchControllerState = {
        ...state,
        error: null,
        loading: !isAppend,
        loadingMore: isAppend,
        sort: action.sort,
      }

      if (action.mode === 'replace') {
        nextState.query = action.query
      }
      if (!isAppend) {
        nextState.inputDirty = false
        nextState.activeSearchText = action.query
        nextState.activeAdvancedFilters = action.filters
      }
      if (!isAppend && !isRefresh) {
        nextState.meta = null
        nextState.results = []
        nextState.pagination = null
      }

      return nextState
    }
    case 'search/succeeded':
      return {
        ...state,
        results:
          action.mode === 'append'
            ? [...state.results, ...(action.response.results || [])]
            : action.response.results || [],
        meta: action.response.meta || null,
        pagination: action.response.pagination || null,
        advancedDraft: action.response.meta?.ui?.advanced || {},
        sort:
          action.mode === 'append'
            ? state.sort
            : action.response.meta?.appliedSort ?? action.requestSort,
      }
    case 'search/failed':
      return {
        ...state,
        error: action.message,
        meta: null,
        results: [],
        pagination: null,
      }
    case 'search/finished':
      return { ...state, loading: false, loadingMore: false }
    case 'search/cleared':
      return {
        ...state,
        activeSearchText: '',
        activeAdvancedFilters: {},
        results: [],
        meta: null,
        pagination: null,
        error: null,
        loading: false,
        loadingMore: false,
        advancedDraft: {},
      }
  }
}
