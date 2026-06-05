import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, vi } from 'vitest'
import type {
  CourseSummaryDto,
  MatchEvidence,
  ResultExplanation,
  ResultWarning,
  SearchCourseMetadataDto,
  SearchActionDto,
  SearchCourseResultDto,
  SearchRequestDto,
  SearchResponseDto,
  SearchTermOptionsDto,
} from '@uiuc-course-search/query-types'
import { TestUiProvider } from '../test/TestUiProvider'
import { SearchPage } from './SearchPage'

const apiMock = vi.hoisted(() => ({
  api: {
    search: vi.fn(),
    getTermOptions: vi.fn(async (): Promise<SearchTermOptionsDto> => ({
      terms: [],
      years: [],
    })),
  },
}))

vi.mock('../lib/api-client', () => ({
  api: apiMock.api,
}))

export const api = apiMock.api

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

type SearchResultOverride = Omit<
  Partial<CourseSummaryDto>,
  'metrics' | 'catalog' | 'scheduleNotes' | 'registration'
> & {
  metrics?: Partial<CourseSummaryDto['metrics']>
  catalog?: Partial<CourseSummaryDto['catalog']>
  scheduleNotes?: Partial<CourseSummaryDto['scheduleNotes']>
  registration?: Partial<CourseSummaryDto['registration']>
  search?: SearchCourseMetadataDto
  matchEvidence?: MatchEvidence[]
  explanation?: ResultExplanation
  warnings?: ResultWarning[]
}

export function course(overrides: SearchResultOverride = {}): SearchCourseResultDto {
  const summary: CourseSummaryDto = {
    id: overrides.id ?? 'CS-225-2026-spring',
    subject: overrides.subject ?? 'CS',
    number: overrides.number ?? '225',
    title: overrides.title ?? 'Data Structures',
    description: overrides.description ?? 'A course',
    creditHours: overrides.creditHours ?? 4,
    year: overrides.year ?? 2026,
    term: overrides.term ?? 'spring',
    primaryInstructor: overrides.primaryInstructor ?? null,
    metrics: {
      primaryInstructorRating:
        overrides.metrics?.primaryInstructorRating ?? null,
      avgGpa: overrides.metrics?.avgGpa ?? null,
      medianGpa: overrides.metrics?.medianGpa ?? null,
      gpaSampleSize: overrides.metrics?.gpaSampleSize ?? null,
      qualityScore: overrides.metrics?.qualityScore ?? null,
      workloadScore: overrides.metrics?.workloadScore ?? null,
    },
    catalog: {
      courseInfo: overrides.catalog?.courseInfo ?? null,
      degreeAttributes: overrides.catalog?.degreeAttributes ?? null,
    },
    scheduleNotes: {
      classScheduleInfo: overrides.scheduleNotes?.classScheduleInfo ?? null,
      dateRangeText: overrides.scheduleNotes?.dateRangeText ?? null,
    },
    registration: {
      registrationNotes: overrides.registration?.registrationNotes ?? null,
      approvalCode: overrides.registration?.approvalCode ?? null,
    },
    requirements: overrides.requirements ?? [],
    instructorLinks: overrides.instructorLinks ?? {},
    links: overrides.links ?? {},
  }

  return {
    course: summary,
    search: overrides.search,
    matchEvidence: overrides.matchEvidence,
    explanation: overrides.explanation,
    warnings: overrides.warnings,
  }
}

export function searchResponse(
  results: SearchCourseResultDto[],
  nextRequest: SearchRequestDto | string
): SearchResponseDto {
  const request =
    typeof nextRequest === 'string' ? { query: nextRequest } : nextRequest
  return {
    results,
    meta: {
      query: { raw: request.query, residual: request.query },
      nextRequest: request,
      timing: { extraction_ms: 1, search_ms: 2, total_ms: 3 },
    },
    pagination: { totalResults: results.length, limit: 20, offset: 0 },
  }
}

export function searchAction(nextRequest: SearchRequestDto): SearchActionDto {
  return {
    kind: 'run_search',
    nextRequest,
  }
}

export function renderSearchPage() {
  return render(
    <TestUiProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </TestUiProvider>
  )
}

export function setQuery(value: string) {
  fireEvent.change(screen.getByLabelText(/course search query/i), {
    target: { value },
  })
}

export function submitSearch() {
  fireEvent.submit(screen.getByRole('search'))
}

export function expectSearchCalledWithRequest(
  request: Record<string, unknown>,
  options = expect.objectContaining({ signal: expect.any(AbortSignal) })
) {
  expect(api.search).toHaveBeenCalledWith(
    expect.objectContaining(request),
    options
  )
}

export function expectLastSearchCalledWithRequest(
  request: Record<string, unknown>
) {
  expect(api.search).toHaveBeenLastCalledWith(
    expect.objectContaining(request),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
})
