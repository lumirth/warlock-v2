import {
  type AdvancedSearchStateDto,
  coerceSearchRequestDto,
  searchRequestHasFilters,
  type SearchRequestDto,
} from '@uiuc-course-search/query-types'

export function advancedFiltersChanged(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return stableAdvancedState(previous) !== stableAdvancedState(next)
}

export function hasAdvancedFilterValue(state: AdvancedSearchStateDto): boolean {
  return (
    hasSearchableAdvancedFilterValue(state) ||
    normalizeAdvancedValue(state.scope) !== ''
  )
}

export function hasSearchableAdvancedFilterValue(
  state: AdvancedSearchStateDto
): boolean {
  return searchRequestHasFilters({ filters: cleanAdvancedFilters(state).filters })
}

export function cleanAdvancedFilters(
  state: AdvancedSearchStateDto
): AdvancedSearchStateDto {
  return advancedStateFromRequest({
    query: '',
    filters: state.filters,
    scope: state.scope,
  })
}

export function advancedStateFromRequest(
  request: SearchRequestDto
): AdvancedSearchStateDto {
  const normalized = coerceSearchRequestDto(request)
  return {
    filters: normalized.filters,
    ...(normalized.scope === 'all' ? { scope: normalized.scope } : {}),
  }
}

export function advancedFiltersContradictQuery(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  const previousState = cleanAdvancedFilters(previous)
  const nextState = cleanAdvancedFilters(next)

  return Object.keys(previousState.filters).some((key) => {
    const filterKey = key as keyof typeof previousState.filters
    const previousValue = normalizeAdvancedValue(
      previousState.filters[filterKey]
    )
    if (!previousValue) return false

    return !advancedValuesEqual(
      previousState.filters[filterKey],
      nextState.filters[filterKey]
    )
  })
}

function normalizeAdvancedValue(
  value:
    | AdvancedSearchStateDto['scope']
    | AdvancedSearchStateDto['filters'][keyof AdvancedSearchStateDto['filters']]
): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value.trim().toLowerCase()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function advancedValuesEqual(
  left:
    | AdvancedSearchStateDto['scope']
    | AdvancedSearchStateDto['filters'][keyof AdvancedSearchStateDto['filters']],
  right:
    | AdvancedSearchStateDto['scope']
    | AdvancedSearchStateDto['filters'][keyof AdvancedSearchStateDto['filters']]
): boolean {
  return normalizeAdvancedValue(left) === normalizeAdvancedValue(right)
}

function stableAdvancedState(state: AdvancedSearchStateDto): string {
  return JSON.stringify(cleanAdvancedFilters(state))
}
