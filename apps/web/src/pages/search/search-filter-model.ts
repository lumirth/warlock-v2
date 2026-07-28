import {
  type AdvancedSearchStateDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchRequestDto,
} from '@uiuc-course-search/query-types'

export type AdvancedFilterErrors = Partial<
  Record<SearchRequestFilterKey, string>
>

export type AdvancedFilterValidation =
  | { ok: true; value: AdvancedSearchStateDto; errors: AdvancedFilterErrors }
  | { ok: false; value: AdvancedSearchStateDto; errors: AdvancedFilterErrors }

export function advancedFiltersChanged(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return stableAdvancedState(previous) !== stableAdvancedState(next)
}

export function hasAdvancedFilterValue(state: AdvancedSearchStateDto): boolean {
  return hasSearchableAdvancedFilterValue(state) || state.scope === 'all'
}

export function hasSearchableAdvancedFilterValue(
  state: AdvancedSearchStateDto
): boolean {
  return Object.values(cleanAdvancedFilters(state).filters).some(
    (value) => value !== undefined
  )
}

export function cleanAdvancedFilters(
  state: AdvancedSearchStateDto
): AdvancedSearchStateDto {
  const filters: SearchRequestFiltersDto = {}

  for (const [rawKey, rawValue] of Object.entries(state.filters)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue
    const key = rawKey as SearchRequestFilterKey

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim()
      if (!trimmed) continue
      const normalized =
        key === 'subject' || key === 'number' || key === 'days'
          ? trimmed.toUpperCase()
          : trimmed
      Object.assign(filters, { [key]: normalized })
      continue
    }

    Object.assign(filters, { [key]: rawValue })
  }

  return {
    filters,
    ...(state.scope === 'all' ? { scope: 'all' as const } : {}),
  }
}

export function advancedStateFromRequest(
  request: SearchRequestDto
): AdvancedSearchStateDto {
  return cleanAdvancedFilters({
    filters: request.filters ?? {},
    ...(request.scope === 'all' ? { scope: request.scope } : {}),
  })
}

export function validateAdvancedFilters(
  state: AdvancedSearchStateDto
): AdvancedFilterValidation {
  const value = cleanAdvancedFilters(state)
  const errors: AdvancedFilterErrors = {}
  const { filters } = value

  if (filters.subject && !/^[A-Z]{2,4}$/.test(filters.subject)) {
    errors.subject = 'Use a 2 to 4 letter subject code, such as CS.'
  }
  if (filters.number && !/^\d{3}[A-Z]?$/.test(filters.number)) {
    errors.number = 'Use a 3 digit course number with an optional letter.'
  }
  if (filters.instructor && filters.instructor.length > 80) {
    errors.instructor = 'Use 80 characters or fewer.'
  }
  if (filters.days && !/^[MTWRFSU]{1,7}$/.test(filters.days)) {
    errors.days = 'Use day letters such as MWF or TR. R means Thursday.'
  }
  if (
    filters.year !== undefined &&
    (!Number.isInteger(filters.year) ||
      filters.year < 2000 ||
      filters.year > 2100)
  ) {
    errors.year = 'Choose a supported offering year.'
  }

  return Object.keys(errors).length === 0
    ? { ok: true, value, errors }
    : { ok: false, value, errors }
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
