import type {
  AdvancedSearchStateDto,
  CourseDto,
  FeedbackResponseDto,
  FeedbackSubmitDto,
  SearchSort,
  SearchResponseDto,
} from '@uiuc-course-search/query-types'

// Allow base URL configuration via env var
const DEFAULT_API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://uiuc-course-search.lumirth.workers.dev' : '')

export type SearchRequestOptions = {
  signal?: AbortSignal
  limit?: number
  offset?: number
  filters?: AdvancedSearchStateDto
  sort?: SearchSort
}

export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = DEFAULT_API_BASE) {
    this.baseUrl = baseUrl
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    // Ensure no double slashes by stripping trailing slash from base and leading slash from path
    const cleanBase = this.baseUrl.replace(/\/$/, '')
    const cleanPath = path.replace(/^\//, '')
    const url = `${cleanBase}/${cleanPath}`

    const res = await fetch(url, init)

    if (!res.ok) {
      // Try to parse JSON error message
      let apiError: string | null = null
      try {
        const errorBody = (await res.json()) as { error?: string }
        if (errorBody.error) {
          apiError = errorBody.error
        }
      } catch {
        // Ignore JSON parse error, fall through to status text
      }
      if (apiError) {
        throw new Error(apiError)
      }
      throw new Error(`API Error: ${res.status} ${res.statusText}`)
    }

    return res.json()
  }

  async search(
    query: string,
    options?: SearchRequestOptions | AbortSignal
  ): Promise<SearchResponseDto> {
    const requestOptions: SearchRequestOptions =
      options instanceof AbortSignal ? { signal: options } : (options ?? {})
    const params = new URLSearchParams({ q: query })
    if (requestOptions.limit !== undefined)
      params.set('limit', requestOptions.limit.toString())
    if (requestOptions.offset !== undefined)
      params.set('offset', requestOptions.offset.toString())
    appendSearchFilters(params, requestOptions.filters)
    appendSearchSort(params, requestOptions.sort)

    return this.fetch<SearchResponseDto>(`api/search?${params.toString()}`, {
      signal: requestOptions.signal,
    })
  }

  async getCourse(
    subject: string,
    number: string,
    term?: string,
    year?: number,
    signal?: AbortSignal
  ): Promise<CourseDto> {
    const params = new URLSearchParams()
    if (term) params.append('term', term)
    if (year) params.append('year', year.toString())
    const queryString = params.toString() ? `?${params.toString()}` : ''

    return this.fetch<CourseDto>(
      `api/course/${subject}/${number}${queryString}`,
      { signal }
    )
  }

  async submitFeedback(
    feedback: FeedbackSubmitDto,
    signal?: AbortSignal
  ): Promise<FeedbackResponseDto> {
    return this.fetch<FeedbackResponseDto>('api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
      signal,
    })
  }
}

function appendSearchFilters(
  params: URLSearchParams,
  filters: AdvancedSearchStateDto | undefined
) {
  if (!filters) return

  if (filters.subject) params.set('subject', filters.subject)
  if (filters.number) params.set('number', filters.number)
  if (filters.instructor) params.set('instructor', filters.instructor)
  if (filters.term) params.set('term', filters.term)
  if (filters.year !== undefined) params.set('year', filters.year.toString())
  if (filters.gened) params.set('gened', filters.gened)
  if (filters.credits !== undefined)
    params.set('credits', filters.credits.toString())
  if (filters.days) params.set('days', filters.days)
  if (filters.time) params.set('time', filters.time)
  if (filters.online !== undefined) params.set('online', String(filters.online))
  if (filters.status) params.set('status', filters.status)
  if (filters.difficulty) params.set('difficulty', filters.difficulty)
  if (filters.level !== undefined) params.set('level', filters.level.toString())
  if (filters.scope) params.set('scope', filters.scope)
}

function appendSearchSort(params: URLSearchParams, sort: SearchSort | undefined) {
  if (!sort || sort.field === 'relevance') return

  params.set('sort', sort.field)
  params.set('direction', sort.direction)
}

export const api = new ApiClient()
