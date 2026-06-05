import {
  searchRequestToQueryEntries,
  type SearchRequestDto,
} from '@uiuc-course-search/query-types'

export function searchRequestToQueryParams(
  request: SearchRequestDto
): URLSearchParams {
  return new URLSearchParams(searchRequestToQueryEntries(request))
}
