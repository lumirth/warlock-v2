import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, vi } from 'vitest'
import type {
  SearchActionDto,
  SearchCourseResultDto,
  SearchRequestDto,
  SearchResponseDto,
} from '@uiuc-course-search/query-types'
import { TestUiProvider } from '../test/TestUiProvider'
import { SearchPage } from './SearchPage'

const apiMock = vi.hoisted(() => ({
  api: {
    search: vi.fn(),
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

export function course(
  overrides: Partial<SearchCourseResultDto>
): SearchCourseResultDto {
  return {
    id: 'CS-225-2026-spring',
    subject: 'CS',
    number: '225',
    title: 'Data Structures',
    description: 'A course',
    credit_hours: 4,
    year: 2026,
    term: 'spring',
    primary_instructor: null,
    primary_instructor_rmp: null,
    avg_gpa: null,
    median_gpa: null,
    gpa_sample_size: null,
    quality_score: null,
    difficulty_score: null,
    course_info: null,
    degree_attributes: null,
    class_schedule_info: null,
    date_range_text: null,
    registration_notes: null,
    approval_code: null,
    geneds: [],
    instructor_links: {},
    ...overrides,
  }
}

export function searchResponse(
  results: SearchCourseResultDto[]
): SearchResponseDto {
  return {
    results,
    meta: {
      query: { raw: 'cs', residual: 'cs' },
      timing: { extraction_ms: 1, search_ms: 2, total_ms: 3 },
    },
    pagination: { total: results.length, limit: 20, offset: 0 },
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
