import {
  type AdvancedSearchStateDto,
  normalizeSearchRequestDto,
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
  return Object.values(cleanAdvancedFilters(state)).some((value) =>
    Boolean(normalizeAdvancedValue(value))
  )
}

export function hasSearchableAdvancedFilterValue(
  state: AdvancedSearchStateDto
): boolean {
  const { scope: _scope, ...filters } = cleanAdvancedFilters(state)
  return searchRequestHasFilters({ filters })
}

export function cleanAdvancedFilters(
  state: AdvancedSearchStateDto
): AdvancedSearchStateDto {
  return advancedStateFromRequest({
    query: '',
    filters: state,
    scope: state.scope,
  })
}

export function advancedStateFromRequest(
  request: SearchRequestDto
): AdvancedSearchStateDto {
  const normalized = normalizeSearchRequestDto(request)
  return {
    ...normalized.filters,
    ...(normalized.scope === 'all' ? { scope: normalized.scope } : {}),
  }
}

export function advancedFiltersContradictQuery(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  const previousState = cleanAdvancedFilters(previous)
  const nextState = cleanAdvancedFilters(next)
  const { scope: _previousScope, ...previousFilters } = previousState

  return Object.keys(previousFilters).some((key) => {
    const filterKey = key as keyof AdvancedSearchStateDto
    const previousValue = normalizeAdvancedValue(previousState[filterKey])
    if (!previousValue) return false

    return !advancedValuesEqual(previousState[filterKey], nextState[filterKey])
  })
}

function normalizeAdvancedValue(
  value: AdvancedSearchStateDto[keyof AdvancedSearchStateDto]
): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value.trim().toLowerCase()
  return String(value)
}

function advancedValuesEqual(
  left: AdvancedSearchStateDto[keyof AdvancedSearchStateDto],
  right: AdvancedSearchStateDto[keyof AdvancedSearchStateDto]
): boolean {
  return normalizeAdvancedValue(left) === normalizeAdvancedValue(right)
}

function stableAdvancedState(state: AdvancedSearchStateDto): string {
  return JSON.stringify(cleanAdvancedFilters(state))
}
