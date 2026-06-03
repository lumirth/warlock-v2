import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDto, SearchResponseDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { TestMantineProvider } from '../test/TestMantineProvider'
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
    <TestMantineProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </TestMantineProvider>
  )
}

function setQuery(value: string) {
  fireEvent.change(screen.getByLabelText(/course search query/i), {
    target: { value },
  })
}

function submitSearch() {
  fireEvent.submit(screen.getByRole('search'))
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
      .mockImplementationOnce((_query, options) => {
        secondSignal = options instanceof AbortSignal ? options : options?.signal
        return second.promise
      })
      .mockImplementationOnce(() => third.promise)

    renderSearchPage()

    setQuery('first')
    submitSearch()

    setQuery('second')
    submitSearch()

    await act(async () => {
      first.reject(abortError())
      await first.promise.catch(() => undefined)
    })

    setQuery('third')
    submitSearch()

    expect(secondSignal?.aborted).toBe(true)
  })

  it('submits the primary search through the form without a standalone search button', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([
      course({ id: 'CS-225-2026-spring', number: '225', title: 'Data Structures' }),
    ]))

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    await screen.findByText(/CS 225: Data Structures/i)
    expect(api.search).toHaveBeenCalledWith('cs 225', expect.objectContaining({
      limit: 20,
      offset: 0,
    }))
    expect(screen.queryByRole('button', { name: /^search$/i })).not.toBeInTheDocument()
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
    submitSearch()
    await screen.findByText(/CS 225: Data Structures/i)

    setQuery('broken')
    submitSearch()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Search failed/i)
    await waitFor(() => {
      expect(screen.queryByText(/CS 225: Data Structures/i)).not.toBeInTheDocument()
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('renders public match evidence chips for search results', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([
      course({
        id: 'CS-225-2026-spring',
        number: '225',
        title: 'Data Structures',
        _score: 0.91,
        match_evidence: [
          { kind: 'course_code', label: 'Course CS 225', source: 'filter', weight: 'hard', value: 'CS 225' },
          { kind: 'keyword', label: 'Strong keyword match', source: 'keyword', weight: 'rank', value: '1' },
        ],
      }),
    ]))

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    await screen.findByText(/CS 225: Data Structures/i)
    expect(screen.getByText('Course CS 225')).toBeInTheDocument()
    expect(screen.getByText('Strong keyword match')).toBeInTheDocument()
    expect(screen.getByText('Strong match')).toBeInTheDocument()
    expect(screen.queryByText(/rank #/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Match 0\./i)).not.toBeInTheDocument()
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
    submitSearch()

    const title = await screen.findByText(/CS 225: Data Structures/i)
    const card = title.closest('a')
    expect(within(card!).getByText('Quality')).toBeInTheDocument()
    expect(within(card!).getByText('B+')).toBeInTheDocument()
    expect(within(card!).getByText('Workload')).toBeInTheDocument()
    expect(within(card!).getByText('Easy')).toBeInTheDocument()
    expect(within(card!).getByText('Instructor')).toBeInTheDocument()
    expect(within(card!).getByText('4.8')).toBeInTheDocument()
    expect(within(card!).getByText('Avg GPA')).toBeInTheDocument()
    expect(within(card!).getByText('3.62')).toBeInTheDocument()
    expect(within(card!).getByTitle('Based on 820 GPA records')).toBeInTheDocument()
  })

  it('de-emphasizes historical result cards and places the status next to the term', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([
      course({
        id: 'CS-225-2026-spring',
        number: '225',
        title: 'Data Structures',
        _historical: true,
        _score: 0.81,
      }),
    ]))

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    const title = await screen.findByText(/CS 225: Data Structures/i)
    const card = title.closest('a')
    expect(card).toHaveAttribute('data-historical', 'true')
    expect(card).toHaveClass('course-result-card--historical')
    expect(within(card!).getByText('Spring 2026')).toBeInTheDocument()
    expect(within(card!).getByText('Historical term')).toBeInTheDocument()
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
    submitSearch()

    await screen.findByText('Instructor fagen')
    fireEvent.click(screen.getByRole('button', { name: /remove instructor fagen/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('algorithms', expect.objectContaining({
        signal: expect.any(AbortSignal),
        limit: 20,
        offset: 0,
      }))
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('professor fagen algorithms')
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
    submitSearch()

    await screen.findByRole('button', { name: /use cultural studies/i })
    fireEvent.click(screen.getByRole('button', { name: /use cultural studies/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('gened:CS', expect.objectContaining({
        signal: expect.any(AbortSignal),
        limit: 20,
        offset: 0,
      }))
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('CS gened')
  })

  it('builds a query from advanced controls while preserving free-text terms', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'algorithms', residual: 'algorithms' },
          ui: {
            chips: [],
            advanced: {},
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('algorithms')
    submitSearch()
    await screen.findByText('Refine results')

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'cs' } })
    fireEvent.change(screen.getByLabelText('Course number'), { target: { value: '225' } })
    fireEvent.change(screen.getByLabelText('Instructor'), { target: { value: 'Fagen' } })
    fireEvent.change(screen.getByLabelText('Credits'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('CS 225 professor Fagen 4 credits algorithms', expect.objectContaining({
        signal: expect.any(AbortSignal),
        limit: 20,
        offset: 0,
      }))
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('algorithms')
  })

  it('clears stale search text when advanced filters contradict parsed query filters', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'intro to CS', residual: 'intro to' },
          ui: {
            chips: [{
              id: 'subject-0',
              type: 'subject',
              label: 'Subject CS',
              value: 'CS',
              source: 'natural_language',
              removable: true,
              editable: true,
              queryPatch: { removeText: 'CS' },
            }],
            advanced: { subject: 'CS' },
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()
    await screen.findByText('Subject CS')

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'PHIL' } })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('subject:PHIL', expect.objectContaining({
        signal: expect.any(AbortSignal),
        limit: 20,
        offset: 0,
      }))
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('')
  })

  it('keeps meaningful residual text when advanced filters replace parsed query filters', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'CS algorithms', residual: 'algorithms' },
          ui: {
            chips: [{
              id: 'subject-0',
              type: 'subject',
              label: 'Subject CS',
              value: 'CS',
              source: 'natural_language',
              removable: true,
              editable: true,
              queryPatch: { removeText: 'CS' },
            }],
            advanced: { subject: 'CS' },
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('CS algorithms')
    submitSearch()
    await screen.findByText('Subject CS')

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'PHIL' } })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expect(api.search).toHaveBeenLastCalledWith('subject:PHIL algorithms', expect.objectContaining({
        signal: expect.any(AbortSignal),
        limit: 20,
        offset: 0,
      }))
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('algorithms')
  })

  it('keeps advanced apply disabled until filters differ from the interpreted query', async () => {
    vi.mocked(api.search).mockResolvedValueOnce({
      ...searchResponse([]),
      meta: {
        ...searchResponse([]).meta,
        query: { raw: 'intro to CS', residual: 'intro to' },
        ui: {
          chips: [{
            id: 'subject-0',
            type: 'subject',
            label: 'Subject CS',
            value: 'CS',
            source: 'natural_language',
            removable: true,
            editable: true,
            queryPatch: { removeText: 'CS' },
          }],
          advanced: { subject: 'CS' },
          ambiguityActions: [],
        },
      },
    })

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()
    await screen.findByText('Subject CS')

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'PHIL' } })
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /reset fields/i }))
    expect(screen.getByLabelText('Subject')).toHaveValue('CS')
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeDisabled()
  })

  it('loads more from the refined query without changing the visible search text', async () => {
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
      .mockResolvedValueOnce({
        ...searchResponse([
          course({ id: 'CS-374-2026-spring', number: '374', title: 'Introduction to Algorithms' }),
        ]),
        pagination: { total: 21, limit: 20, offset: 0, hasMore: true, nextOffset: 20 },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({ id: 'CS-473-2026-spring', number: '473', title: 'Algorithms' }),
        ]),
        pagination: { total: 21, limit: 20, offset: 20, hasMore: false, nextOffset: null },
      })

    renderSearchPage()

    setQuery('professor fagen algorithms')
    submitSearch()

    await screen.findByText('Instructor fagen')
    fireEvent.click(screen.getByRole('button', { name: /remove instructor fagen/i }))

    await screen.findByText(/CS 374: Introduction to Algorithms/i)
    fireEvent.click(screen.getByRole('button', { name: /show more results/i }))

    await screen.findByText(/CS 473: Algorithms/i)
    expect(api.search).toHaveBeenLastCalledWith('algorithms', expect.objectContaining({
      signal: expect.any(AbortSignal),
      limit: 20,
      offset: 20,
    }))
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('professor fagen algorithms')
  })

  it('loads the next page of results without replacing the current page', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([
          course({ id: 'CS-100-2026-spring', number: '100', title: 'Freshman Orientation' }),
        ]),
        pagination: { total: 21, limit: 20, offset: 0, hasMore: true, nextOffset: 20 },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({ id: 'CS-124-2026-spring', number: '124', title: 'Introduction to Computer Science I' }),
        ]),
        pagination: { total: 21, limit: 20, offset: 20, hasMore: false, nextOffset: null },
      })

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()

    await screen.findByText(/CS 100: Freshman Orientation/i)
    fireEvent.click(screen.getByRole('button', { name: /show more results/i }))

    await screen.findByText(/CS 124: Introduction to Computer Science I/i)
    expect(screen.getByText(/CS 100: Freshman Orientation/i)).toBeInTheDocument()
    expect(api.search).toHaveBeenLastCalledWith('intro to CS', expect.objectContaining({
      signal: expect.any(AbortSignal),
      limit: 20,
      offset: 20,
    }))
  })

  it('falls back to offset plus limit when a hasMore page omits nextOffset', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([
          course({ id: 'CS-100-2026-spring', number: '100', title: 'Freshman Orientation' }),
        ]),
        pagination: { total: 21, limit: 20, offset: 0, hasMore: true },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({ id: 'CS-101-2026-spring', number: '101', title: 'Intro Computing' }),
        ]),
        pagination: { total: 22, limit: 20, offset: 20, hasMore: true },
      })

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()

    await screen.findByText(/CS 100: Freshman Orientation/i)
    fireEvent.click(screen.getByRole('button', { name: /show more results/i }))

    await screen.findByText(/CS 101: Intro Computing/i)
    expect(api.search).toHaveBeenLastCalledWith('intro to CS', expect.objectContaining({
      signal: expect.any(AbortSignal),
      limit: 20,
      offset: 20,
    }))
  })
})
