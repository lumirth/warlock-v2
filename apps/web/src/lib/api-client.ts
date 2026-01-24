import { Course, SearchResponse, Section, RawCourseResponse, RawSection } from './api-types'

// Allow base URL configuration via env var
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://uiuc-course-search.lumirth.workers.dev' : '');

class ApiClient {
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
      try {
        const errorBody = await res.json() as { error?: string }
        if (errorBody.error) {
          throw new Error(errorBody.error)
        }
      } catch (e) {
        // Ignore JSON parse error, fall through to status text
      }
      throw new Error(`API Error: ${res.status} ${res.statusText}`)
    }

    return res.json()
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResponse> {
    return this.fetch<SearchResponse>(`api/search?q=${encodeURIComponent(query)}`, { signal })
  }

  async getCourse(subject: string, number: string, signal?: AbortSignal): Promise<Course> {
    const rawData = await this.fetch<RawCourseResponse>(`api/course/${subject}/${number}`, { signal })

    // Normalize sections if present
    const normalizedSections = rawData.sections
      ? rawData.sections.map(this.normalizeSection)
      : undefined

    // Construct a clean Course object to avoid mutating rawData or unsafe casting
    return {
      id: rawData.id,
      subject: rawData.subject,
      number: rawData.number,
      title: rawData.title,
      description: rawData.description ?? null,
      credit_hours: rawData.credit_hours ?? null,
      gened: rawData.gened ?? null,
      year: rawData.year,
      term: rawData.term,
      primary_instructor: rawData.primary_instructor ?? null,
      quality_score: rawData.quality_score ?? null,
      difficulty_score: rawData.difficulty_score ?? null,
      _score: rawData._score,
      _historical: rawData._historical,
      sections: normalizedSections
    }
  }

  // Helper to normalize the messy mix of DB (snake_case) and Fresh (camelCase) section data
  private normalizeSection(s: RawSection): Section {
    return {
      crn: s.crn,
      sectionNumber: s.sectionNumber ?? s.section_number ?? '?',
      status: s.enrollmentStatus ?? s.status ?? 'Unknown',
      type: s.type ?? '?',
      days: s.days ?? null,
      startTime: s.startTime ?? s.start_time ?? null,
      endTime: s.endTime ?? s.end_time ?? null,
      location: s.location ?? 'TBA',
      instructor: s.instructor ?? 'TBA',
      instructorRmp: s.instructor_rmp ?? null,
      instructorGpa: s.instructor_gpa ?? null
    }
  }
}

export const api = new ApiClient()
