import {
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  type AdvancedSearchStateDto,
  type SearchChipDto,
  type SearchRequestFilterPatchDto,
} from '@uiuc-course-search/query-types'

const ADVANCED_SEARCH_KEYS: (keyof AdvancedSearchStateDto)[] = [
  'subject',
  'number',
  'instructor',
  'term',
  'year',
  'gened',
  'credits',
  'days',
  'time',
  'partOfTerm',
  'online',
  'status',
  'difficulty',
  'level',
  'scope',
]

const ADVANCED_CONTRADICTION_KEYS = ADVANCED_SEARCH_KEYS.filter(
  (key) => key !== 'scope'
)

const WEAK_RESIDUAL_TERMS = new Set([
  'a',
  'an',
  'and',
  'by',
  'class',
  'classes',
  'course',
  'courses',
  'find',
  'for',
  'in',
  'intro',
  'introduction',
  'of',
  'search',
  'the',
  'to',
])

export function removeTextFromQuery(source: string, textToRemove: string): string {
  const normalizedSource = source.trim()
  const normalizedRemove = textToRemove.trim()
  const index = normalizedSource
    .toLowerCase()
    .indexOf(normalizedRemove.toLowerCase())

  if (index < 0) {
    return normalizedSource
  }

  return `${normalizedSource.slice(0, index)} ${normalizedSource.slice(index + normalizedRemove.length)}`
    .replace(/\s+/g, ' ')
    .trim()
}

export function removeChipFromQuery(
  source: string,
  chip: SearchChipDto
): string {
  if (chip.id === 'gened-any') {
    return source
      .trim()
      .replace(/\b(?:gen\s*-?\s*ed|gened)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return removeTextFromQuery(source, chip.queryPatch?.removeText || chip.value)
}

export function advancedFiltersChanged(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return ADVANCED_SEARCH_KEYS.some(
    (key) => !advancedValuesEqual(previous[key], next[key])
  )
}

export function hasAdvancedFilterValue(state: AdvancedSearchStateDto): boolean {
  return ADVANCED_SEARCH_KEYS.some((key) =>
    Boolean(normalizeAdvancedValue(state[key]))
  )
}

export function cleanAdvancedFilters(
  state: AdvancedSearchStateDto
): AdvancedSearchStateDto {
  const next: AdvancedSearchStateDto = {}

  if (state.subject?.trim()) next.subject = state.subject.trim().toUpperCase()
  if (state.number?.trim()) next.number = state.number.trim()
  if (state.instructor?.trim()) next.instructor = state.instructor.trim()
  if (state.term?.trim()) {
    const term = state.term.trim().toLowerCase()
    if (isSearchTermFilter(term)) {
      next.term = term
    }
  }
  if (typeof state.year === 'number') next.year = state.year
  if (state.gened?.trim()) next.gened = state.gened.trim().toUpperCase()
  if (typeof state.credits === 'number') next.credits = state.credits
  if (state.days?.trim()) next.days = state.days.trim().toUpperCase()
  if (state.time?.trim()) {
    const time = state.time.trim().toLowerCase()
    if (isSearchTimeFilter(time)) {
      next.time = time
    }
  }
  if (state.partOfTerm?.trim()) {
    next.partOfTerm = state.partOfTerm.trim().toUpperCase()
  }
  if (state.online !== undefined) next.online = state.online
  if (state.status?.trim()) {
    const status = state.status.trim().toLowerCase()
    if (isSearchStatusFilter(status)) {
      next.status = status
    }
  }
  if (state.difficulty === 'easy' || state.difficulty === 'hard') {
    next.difficulty = state.difficulty
  }
  if (
    typeof state.level === 'number' &&
    isSearchLevelFilter(state.level)
  ) {
    next.level = state.level
  }
  if (state.scope === 'all') {
    next.scope = 'all'
  }

  return next
}

export function advancedStateFromFilter(
  filter: SearchRequestFilterPatchDto | undefined
): AdvancedSearchStateDto {
  if (!filter) return {}

  return cleanAdvancedFilters({
    subject: filter.subject,
    number: filter.number,
    term: filter.term,
    year: filter.year,
    gened: filter.gened,
    credits: filter.credits,
    days: filter.days,
    time: filter.time,
    partOfTerm: filter.partOfTerm,
    online: filter.online,
    status: filter.status,
    difficulty: filter.difficulty,
    level: filter.level,
  })
}

export function advancedFiltersForChipRemoval(
  state: AdvancedSearchStateDto,
  chip: SearchChipDto
): AdvancedSearchStateDto | null {
  const next = { ...state }
  let changed = false
  const filter = chip.filter

  if (chip.type === 'instructor' && next.instructor) {
    delete next.instructor
    changed = true
  }

  if (filter?.subject && next.subject === filter.subject) {
    delete next.subject
    changed = true
  }
  if (filter?.number && next.number === filter.number) {
    delete next.number
    changed = true
  }
  if (filter?.term && next.term === filter.term) {
    delete next.term
    changed = true
  }
  if (filter?.year !== undefined && next.year === filter.year) {
    delete next.year
    changed = true
  }
  if (filter?.gened && next.gened === filter.gened) {
    delete next.gened
    changed = true
  }
  if (filter?.credits !== undefined && next.credits === filter.credits) {
    delete next.credits
    changed = true
  }
  if (filter?.days && next.days === filter.days) {
    delete next.days
    changed = true
  }
  if (filter?.time && next.time === filter.time) {
    delete next.time
    changed = true
  }
  if (filter?.partOfTerm && next.partOfTerm === filter.partOfTerm) {
    delete next.partOfTerm
    changed = true
  }
  if (filter?.online !== undefined && next.online === filter.online) {
    delete next.online
    changed = true
  }
  if (filter?.status && next.status === filter.status) {
    delete next.status
    changed = true
  }
  if (filter?.difficulty && next.difficulty === filter.difficulty) {
    delete next.difficulty
    changed = true
  }
  if (filter?.level !== undefined && next.level === filter.level) {
    delete next.level
    changed = true
  }

  return changed ? cleanAdvancedFilters(next) : null
}

export function advancedFiltersContradictQuery(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return ADVANCED_CONTRADICTION_KEYS.some((key) => {
    const previousValue = normalizeAdvancedValue(previous[key])
    if (!previousValue) return false

    return !advancedValuesEqual(previous[key], next[key])
  })
}

export function meaningfulResidualQuery(residual: string): string {
  const trimmedResidual = residual.trim()
  const meaningfulTokens = trimmedResidual
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token && !WEAK_RESIDUAL_TERMS.has(token))

  return meaningfulTokens.length > 0 ? trimmedResidual : ''
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
