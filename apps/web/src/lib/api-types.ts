export interface SearchMeta {
  query: {
    raw: string
    residual: string
  }
  extraction: {
    hints: Array<{
      type: string
      value: string | number | boolean | { subject?: string; number?: string }
      metadata: { confidence: number; source: string; raw: string }
    }>
  }
  plan: {
    filters: Record<string, unknown>
  }
  ambiguities?: Array<{
    term: string
    chosen: { type: string; value: string; label: string }
    alternatives: { type: string; value: string; label: string }[]
  }>
  timing: {
    extraction_ms: number
    search_ms: number
    total_ms: number
  }
}

// The raw shape from the API (union of DB and Fresh/Live data structures)
export interface RawSection {
  crn: string
  // Snake_case (DB)
  section_number?: string | null
  status?: string | null
  start_time?: string | null
  end_time?: string | null
  instructor_rmp?: number | null
  instructor_gpa?: number | null

  // camelCase (Fresh)
  sectionNumber?: string | null
  enrollmentStatus?: string | null
  startTime?: string | null
  endTime?: string | null

  // Common or Mixed
  type?: string | null
  days?: string | null
  location?: string | null
  instructor?: string | null
}

export interface RawCourseResponse {
  id: string
  subject: string
  number: string
  title: string
  description: string | null
  credit_hours: number | null
  gened: string | null
  year: number
  term: string
  primary_instructor: string | null
  quality_score: number | null
  difficulty_score: number | null
  _score?: number
  _historical?: boolean
  sections?: RawSection[]
}

// The normalized Section type used by our UI
export interface Section {
  crn: string
  sectionNumber: string
  status: string
  type: string
  days: string | null
  startTime: string | null
  endTime: string | null
  location: string
  instructor: string
  instructorRmp: number | null
  instructorGpa: number | null
}

export interface Course {
  id: string
  subject: string
  number: string
  title: string
  description: string | null
  credit_hours: number | null
  gened: string | null
  year: number
  term: string
  primary_instructor: string | null
  quality_score: number | null
  difficulty_score: number | null
  _score?: number
  _historical?: boolean
  sections?: Section[]
}

export interface SearchResponse {
  results: Course[]
  meta: SearchMeta
  pagination: { total: number; limit: number; offset: number }
}
