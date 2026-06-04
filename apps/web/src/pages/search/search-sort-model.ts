import {
  DEFAULT_SEARCH_SORT,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  type SearchSort,
  type SortDirection,
  type SortField,
} from '@uiuc-course-search/query-types'

export const RESULT_VIEW_STORAGE_KEY = 'uiuc-course-search.result-view'

export type ResultViewMode = 'cards' | 'table'

export function readStoredResultViewMode(): ResultViewMode {
  if (typeof window === 'undefined') return 'cards'

  try {
    return window.localStorage.getItem(RESULT_VIEW_STORAGE_KEY) === 'table'
      ? 'table'
      : 'cards'
  } catch {
    return 'cards'
  }
}

export function writeStoredResultViewMode(resultViewMode: ResultViewMode): void {
  try {
    window.localStorage.setItem(RESULT_VIEW_STORAGE_KEY, resultViewMode)
  } catch {
    // Result view persistence is optional.
  }
}

export function normalizeSearchSort(sort: SearchSort): SearchSort {
  const direction =
    sort.field === 'relevance'
      ? SEARCH_SORT_DEFAULT_DIRECTIONS.relevance
      : sort.direction

  return {
    field: sort.field,
    direction,
  }
}

export function nextSortForField(
  field: SortField,
  current: SearchSort
): SearchSort {
  if (field === current.field && field !== 'relevance') {
    return {
      field,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    }
  }

  return {
    field,
    direction: SEARCH_SORT_DEFAULT_DIRECTIONS[field],
  }
}

export function directionLabel(direction: SortDirection): string {
  return direction === 'asc' ? 'Ascending' : 'Descending'
}

export function sortButtonLabel(
  label: string,
  isActive: boolean,
  direction: SortDirection
): string {
  if (!isActive) {
    return `Sort by ${label}, ${directionLabel(direction).toLowerCase()}`
  }

  const nextDirection = direction === 'asc' ? 'desc' : 'asc'
  return `Sort by ${label}, ${directionLabel(nextDirection).toLowerCase()}`
}

export { DEFAULT_SEARCH_SORT }
