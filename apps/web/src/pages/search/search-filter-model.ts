import {
  type AdvancedSearchStateDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchRequestDto,
} from '@warlock-v2/query-types'

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
  return hasSearchableAdvancedFilterValue(state)
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
    const key = rawKey as SearchRequestFilterKey
    const value = cleanFilterValue(key, rawValue)
    if (value !== undefined) Object.assign(filters, { [key]: value })
  }

  return {
    filters,
    ...(state.scope === 'all' ? { scope: 'all' as const } : {}),
  }
}

function cleanFilterValue(key: SearchRequestFilterKey, value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return ['subject', 'number', 'days'].includes(key) ? trimmed.toUpperCase() : trimmed
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

  checkText(errors, 'subject', filters.subject, (text) => !/^[A-Z]{2,4}$/.test(text), 'Use a 2 to 4 letter subject code, such as CS.')
  checkText(errors, 'number', filters.number, (text) => !/^\d{3}[A-Z]?$/.test(text), 'Use a 3 digit course number with an optional letter.')
  checkText(errors, 'instructor', filters.instructor, (text) => text.length > 80, 'Use 80 characters or fewer.')
  checkText(errors, 'days', filters.days, (text) => !/^[MTWRFSU]{1,7}$/.test(text), 'Use day letters such as MWF or TR. R means Thursday.')
  if (filters.year !== undefined && invalidYear(filters.year)) errors.year = 'Choose a supported offering year.'

  return Object.keys(errors).length === 0
    ? { ok: true, value, errors }
    : { ok: false, value, errors }
}

function checkText(
  errors: AdvancedFilterErrors,
  key: SearchRequestFilterKey,
  value: string | undefined,
  invalid: (value: string) => boolean,
  message: string
) {
  if (value && invalid(value)) errors[key] = message
}

function invalidYear(year: number) {
  return !Number.isInteger(year) || year < 2000 || year > 2100
}

function stableAdvancedState(state: AdvancedSearchStateDto): string {
  return JSON.stringify(cleanAdvancedFilters(state))
}
