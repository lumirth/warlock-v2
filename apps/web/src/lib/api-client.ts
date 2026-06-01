import type { CourseDto, SearchResponseDto } from '@uiuc-course-search/query-types'

// Allow base URL configuration via env var
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://uiuc-course-search.lumirth.workers.dev' : '');

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_API_BASE) {
    this.baseUrl = baseUrl;
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
        const errorBody = await res.json() as { error?: string }
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

  async search(query: string, signal?: AbortSignal): Promise<SearchResponseDto> {
    return this.fetch<SearchResponseDto>(`api/search?q=${encodeURIComponent(query)}`, { signal })
  }

  async getCourse(subject: string, number: string, term?: string, year?: number, signal?: AbortSignal): Promise<CourseDto> {
    const params = new URLSearchParams()
    if (term) params.append('term', term)
    if (year) params.append('year', year.toString())
    const queryString = params.toString() ? `?${params.toString()}` : ''

    return this.fetch<CourseDto>(`api/course/${subject}/${number}${queryString}`, { signal })
  }
}

export const api = new ApiClient()
