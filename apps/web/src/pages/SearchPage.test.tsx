import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDto, SearchResponseDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { SearchPage } from './SearchPage'

vi.mock('../lib/api-client', () => ({
  api: {
    search: vi.fn(),
  },
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function course(overrides: Partial<CourseDto>): CourseDto {
  return {
    id: 'CS-225-2026-spring',
    subject: 'CS',
    number: '225',
    title: 'Data Structures',
    description: 'A course',
    credit_hours: 4,
    gened: null,
    year: 2026,
    term: 'spring',
    primary_instructor: null,
    primary_instructor_rmp: null,
    avg_gpa: null,
    gpa_sample_size: null,
    quality_score: null,
    difficulty_score: null,
    instructor_links: {},
    ...overrides,
  }
}

function searchResponse(results: CourseDto[]): SearchResponseDto {
  return {
    results,
    meta: {
      query: { raw: 'cs', residual: 'cs' },
      extraction: { hints: [] },
      plan: { filters: {}, semanticQuery: 'cs', keywordQuery: 'cs' },
      timing: { extraction_ms: 1, search_ms: 2, total_ms: 3 },
    },
    pagination: { total: results.length, limit: 20, offset: 0 },
  }
}

function renderSearchPage() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </MantineProvider>
  )
}

function setQuery(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/easy cs gened/i), {
    target: { value },
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SearchPage request state', () => {
  it('keeps the active request abortable after an older aborted request settles', async () => {
    const first = deferred<SearchResponseDto>()
    const second = deferred<SearchResponseDto>()
    const third = deferred<SearchResponseDto>()
    let secondSignal: AbortSignal | undefined

    vi.mocked(api.search)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce((_query, signal) => {
        secondSignal = signal
        return second.promise
      })
      .mockImplementationOnce(() => third.promise)

    renderSearchPage()

    setQuery('first')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    setQuery('second')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await act(async () => {
      first.reject(abortError())
      await first.promise.catch(() => undefined)
    })

    setQuery('third')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    expect(secondSignal?.aborted).toBe(true)
  })

  it('clears stale results when a new search fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    vi.mocked(api.search)
      .mockResolvedValueOnce(searchResponse([
        course({ id: 'CS-225-2026-spring', number: '225', title: 'Data Structures' }),
      ]))
      .mockRejectedValueOnce(new Error('Search failed'))

    renderSearchPage()

    setQuery('cs 225')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await screen.findByText(/CS 225: Data Structures/i)

    setQuery('broken')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Search failed/i)
    await waitFor(() => {
      expect(screen.queryByText(/CS 225: Data Structures/i)).not.toBeInTheDocument()
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('renders compact match evidence chips for search results', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([
      course({
        id: 'CS-225-2026-spring',
        number: '225',
        title: 'Data Structures',
        match_evidence: [
          { kind: 'course_code', label: 'Course CS 225', source: 'filter', weight: 'hard', value: 'CS 225' },
          { kind: 'keyword', label: 'Keyword rank #1', source: 'keyword', weight: 'rank', value: '1' },
        ],
      }),
    ]))

    renderSearchPage()

    setQuery('cs 225')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText(/CS 225: Data Structures/i)
    expect(screen.getByText('Course CS 225')).toBeInTheDocument()
    expect(screen.getByText('Keyword rank #1')).toBeInTheDocument()
  })

  it('surfaces quality, difficulty, instructor rating, and GPA on result cards', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([
      course({
        id: 'CS-225-2026-spring',
        number: '225',
        title: 'Data Structures',
        quality_score: 88,
        difficulty_score: 42,
        primary_instructor_rmp: 4.8,
        avg_gpa: 3.62,
        gpa_sample_size: 820,
      }),
    ]))

    renderSearchPage()

    setQuery('cs 225')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText(/CS 225: Data Structures/i)
    expect(screen.getByText('Quality B+')).toBeInTheDocument()
    expect(screen.getByText('Easy workload')).toBeInTheDocument()
    expect(screen.getByText('Instructor rating 4.8')).toBeInTheDocument()
    expect(screen.getByText('Avg GPA 3.62')).toBeInTheDocument()
    expect(screen.getByTitle('Based on 820 GPA records')).toBeInTheDocument()
  })

  it('lets users remove interpreted search chips and reruns the edited query', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'professor fagen algorithms', residual: 'algorithms' },
          ui: {
            chips: [{
              id: 'instructor-0',
              type: 'instructor',
              label: 'Instructor fagen',
              value: 'fagen',
              source: 'natural_language',
              removable: true,
              editable: true,
              queryPatch: { removeText: 'professor fagen' },
            }],
            advanced: { instructor: 'fagen' },
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('professor fagen algorithms')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText('Instructor fagen')
    fireEvent.click(screen.getByRole('button', { name: /remove instructor fagen/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('algorithms', expect.any(AbortSignal))
    })
  })

  it('renders ambiguity alternatives as actionable searches', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'CS gened', residual: '' },
          ui: {
            chips: [],
            advanced: { subject: 'CS' },
            ambiguityActions: [{
              id: '0-0-gened-CS',
              term: 'CS',
              label: 'Cultural Studies',
              filter: { gened_code: 'CS' },
              queryPatch: { replaceQuery: 'gened:CS' },
            }],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('CS gened')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByRole('button', { name: /use cultural studies/i })
    fireEvent.click(screen.getByRole('button', { name: /use cultural studies/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('gened:CS', expect.any(AbortSignal))
    })
  })
})
