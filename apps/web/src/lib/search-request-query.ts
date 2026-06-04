import {
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SEARCH_SORT,
  normalizeSearchRequestDto,
  type SearchRequestDto,
} from '@uiuc-course-search/query-types'

export function searchRequestToQueryParams(
  request: SearchRequestDto
): URLSearchParams {
  return new URLSearchParams(searchRequestToQueryEntries(request))
}

function searchRequestToQueryEntries(
  request: SearchRequestDto
): Array<[string, string]> {
  const normalized = normalizeSearchRequestDto(request)
  const entries: Array<[string, string]> = [['q', normalized.query]]

  if (request.pagination?.limit !== undefined) {
    entries.push(['limit', String(request.pagination.limit)])
  }
  if (request.pagination?.offset !== undefined) {
    entries.push(['offset', String(request.pagination.offset)])
  }

  const { filters } = normalized
  if (filters.subject) entries.push(['subject', filters.subject])
  if (filters.number) entries.push(['number', filters.number])
  if (filters.instructor) entries.push(['instructor', filters.instructor])
  if (filters.term) entries.push(['term', filters.term])
  if (filters.year !== undefined) entries.push(['year', String(filters.year)])
  if (filters.gened) entries.push(['gened', filters.gened])
  if (filters.credits !== undefined) {
    entries.push(['credits', String(filters.credits)])
  }
  if (filters.days) entries.push(['days', filters.days])
  if (filters.time) entries.push(['time', filters.time])
  if (filters.partOfTerm) entries.push(['partOfTerm', filters.partOfTerm])
  if (filters.online !== undefined) entries.push(['online', String(filters.online)])
  if (filters.status) entries.push(['status', filters.status])
  if (filters.difficulty) entries.push(['difficulty', filters.difficulty])
  if (filters.level !== undefined) entries.push(['level', String(filters.level)])

  if (normalized.scope !== DEFAULT_SEARCH_SCOPE) {
    entries.push(['scope', normalized.scope])
  }

  if (normalized.sort.field !== DEFAULT_SEARCH_SORT.field) {
    entries.push(['sort', normalized.sort.field])
    entries.push(['direction', normalized.sort.direction])
  }

  return entries
}
