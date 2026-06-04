import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CourseDto,
  SearchActionDto,
  SearchRequestDto,
  SearchResponseDto,
} from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { TestUiProvider } from '../test/TestUiProvider'
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

function searchResponse(results: CourseDto[]): SearchResponseDto {
  return {
    results,
    meta: {
      query: { raw: 'cs', residual: 'cs' },
      timing: { extraction_ms: 1, search_ms: 2, total_ms: 3 },
    },
    pagination: { total: results.length, limit: 20, offset: 0 },
  }
}

function searchAction(nextRequest: SearchRequestDto): SearchActionDto {
  return {
    kind: 'run_search',
    nextRequest,
  }
}

function renderSearchPage() {
  return render(
    <TestUiProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </TestUiProvider>
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

function expectSearchCalledWithRequest(
  request: Record<string, unknown>,
  options = expect.objectContaining({ signal: expect.any(AbortSignal) })
) {
  expect(api.search).toHaveBeenCalledWith(
    expect.objectContaining(request),
    options
  )
}

function expectLastSearchCalledWithRequest(request: Record<string, unknown>) {
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

describe('SearchPage request state', () => {
  it('shows quiet example queries before the first search and runs them on click', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
      searchResponse([
        course({
          id: 'CS-225-2026-spring',
          number: '225',
          title: 'Data Structures',
        }),
      ])
    )

    renderSearchPage()

    expect(
      screen.getByRole('heading', { level: 1, name: /uiuc course search/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/search uiuc courses the way you'd describe them/i)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'CS 225' }))

    await screen.findByText(/CS 225: Data Structures/i)
    expectSearchCalledWithRequest({
      query: 'CS 225',
      pagination: { limit: 20, offset: 0 },
    })
    expect(
      screen.queryByText(/search uiuc courses the way you'd describe them/i)
    ).not.toBeInTheDocument()
  })

  it('does not render an empty table before the first search when table view is remembered', () => {
    window.localStorage.setItem('uiuc-course-search.result-view', 'table')

    renderSearchPage()

    expect(
      screen.getByText(/search uiuc courses the way you'd describe them/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('keeps the active request abortable after an older aborted request settles', async () => {
    const first = deferred<SearchResponseDto>()
    const second = deferred<SearchResponseDto>()
    const third = deferred<SearchResponseDto>()
    let secondSignal: AbortSignal | undefined

    vi.mocked(api.search)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce((_request, options) => {
        secondSignal = options?.signal
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

  it('ignores a stale search response when the older request resolves late', async () => {
    const first = deferred<SearchResponseDto>()
    const second = deferred<SearchResponseDto>()

    vi.mocked(api.search)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    renderSearchPage()

    setQuery('first')
    submitSearch()

    setQuery('second')
    submitSearch()

    await act(async () => {
      second.resolve(
        searchResponse([
          course({
            id: 'STAT-100-2026-spring',
            subject: 'STAT',
            number: '100',
            title: 'Statistics',
          }),
        ])
      )
      await second.promise
    })

    await screen.findByText(/STAT 100: Statistics/i)

    await act(async () => {
      first.resolve(
        searchResponse([
          course({
            id: 'CS-225-2026-spring',
            number: '225',
            title: 'Data Structures',
          }),
        ])
      )
      await first.promise
    })

    expect(screen.getByText(/STAT 100: Statistics/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/CS 225: Data Structures/i)
    ).not.toBeInTheDocument()
  })

  it('submits the primary search through the form without a standalone search button', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
      searchResponse([
        course({
          id: 'CS-225-2026-spring',
          number: '225',
          title: 'Data Structures',
        }),
      ])
    )

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    await screen.findByText(/CS 225: Data Structures/i)
    expectSearchCalledWithRequest({
      query: 'cs 225',
      pagination: { limit: 20, offset: 0 },
    })
    expect(
      screen.queryByRole('button', { name: /^search$/i })
    ).not.toBeInTheDocument()
  })

  it('clears stale results when a new search fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    vi.mocked(api.search)
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'CS-225-2026-spring',
            number: '225',
            title: 'Data Structures',
          }),
        ])
      )
      .mockRejectedValueOnce(new Error('Search failed'))

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()
    await screen.findByText(/CS 225: Data Structures/i)

    setQuery('broken')
    submitSearch()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/That search did not go through/i)
    expect(alert).toHaveTextContent(/Give it another moment/i)
    expect(alert).not.toHaveTextContent(/Search failed/i)
    await waitFor(() => {
      expect(
        screen.queryByText(/CS 225: Data Structures/i)
      ).not.toBeInTheDocument()
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('renders public match evidence chips for search results', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
      searchResponse([
        course({
          id: 'CS-225-2026-spring',
          number: '225',
          title: 'Data Structures',
          _score: 0.91,
          match_evidence: [
            {
              kind: 'course_code',
              label: 'Course CS 225',
              source: 'filter',
              weight: 'hard',
              value: 'CS 225',
            },
            {
              kind: 'keyword',
              label: 'Strong keyword match',
              source: 'keyword',
              weight: 'rank',
              value: '1',
            },
          ],
        }),
      ])
    )

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    await screen.findByText(/CS 225: Data Structures/i)
    expect(screen.getByText('Course CS 225')).toBeInTheDocument()
    expect(screen.getByText('Strong keyword match')).toBeInTheDocument()
    expect(screen.queryByText('Strong match')).not.toBeInTheDocument()
    expect(screen.queryByText(/rank #/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Match 0\./i)).not.toBeInTheDocument()
  })

  it('surfaces quality, difficulty, instructor rating, and GPA on result cards', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
      searchResponse([
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
      ])
    )

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    const title = await screen.findByText(/CS 225: Data Structures/i)
    const card = title.closest('a')
    expect(within(card!).getByText('Quality')).toBeInTheDocument()
    expect(within(card!).getByText('Excellent')).toBeInTheDocument()
    expect(within(card!).queryByText('B+')).not.toBeInTheDocument()
    expect(within(card!).getByText('Workload')).toBeInTheDocument()
    expect(within(card!).getByText('Easy')).toBeInTheDocument()
    expect(within(card!).getByText('Instructor')).toBeInTheDocument()
    expect(within(card!).getByText('4.8')).toBeInTheDocument()
    expect(within(card!).getByText('Avg GPA')).toBeInTheDocument()
    expect(within(card!).getByText('3.62')).toBeInTheDocument()
    expect(
      within(card!).getAllByTitle('Based on 820 records').length
    ).toBeGreaterThanOrEqual(1)
    expect(
      within(card!).getAllByTitle('Based on 820 GPA records').length
    ).toBeGreaterThanOrEqual(1)
  })

  it('switches to table view and refetches when a sortable table header is clicked', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'CS-225-2026-spring',
            number: '225',
            title: 'Data Structures',
            quality_score: 88,
            difficulty_score: 42,
            avg_gpa: 3.62,
            primary_instructor_rmp: 4.8,
          }),
        ])
      )
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'STAT-100-2026-spring',
            subject: 'STAT',
            number: '100',
            title: 'Statistics',
            avg_gpa: 3.82,
          }),
        ])
      )

    renderSearchPage()

    setQuery('online stats class')
    submitSearch()

    await screen.findByText(/CS 225: Data Structures/i)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sort by avg gpa, descending/i })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /sort by avg gpa, descending/i })
    )

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'online stats class',
        pagination: { limit: 20, offset: 0 },
        sort: { field: 'gpa', direction: 'desc' },
      })
    })
    expect(
      screen.getByRole('columnheader', { name: /avg gpa/i })
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('persists the result view preference across renders', async () => {
    vi.mocked(api.search).mockResolvedValue(
      searchResponse([
        course({
          id: 'CS-225-2026-spring',
          number: '225',
          title: 'Data Structures',
        }),
      ])
    )

    const rendered = renderSearchPage()

    setQuery('cs 225')
    submitSearch()
    await screen.findByText(/CS 225: Data Structures/i)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(window.localStorage.getItem('uiuc-course-search.result-view')).toBe(
      'table'
    )

    rendered.unmount()
    renderSearchPage()

    setQuery('cs 225')
    submitSearch()
    await screen.findByRole('table')
  })

  it('de-emphasizes historical result cards and places the status next to the term', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
      searchResponse([
        course({
          id: 'CS-225-2026-spring',
          number: '225',
          title: 'Data Structures',
          _historical: true,
          _score: 0.81,
        }),
      ])
    )

    renderSearchPage()

    setQuery('cs 225')
    submitSearch()

    const title = await screen.findByText(/CS 225: Data Structures/i)
    const card = title.closest('[data-historical="true"]') as HTMLElement
    expect(card).toHaveAttribute('data-historical', 'true')
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
            chips: [
              {
                id: 'instructor-0',
                type: 'instructor',
                label: 'Instructor fagen',
                value: 'fagen',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'algorithms' }),
              },
            ],
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
    fireEvent.click(
      screen.getByRole('button', { name: /remove instructor fagen/i })
    )

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'algorithms',
        pagination: { limit: 20, offset: 0 },
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'professor fagen algorithms'
    )
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
            ambiguityActions: [
              {
                id: '0-0-gened-CS',
                term: 'CS',
                label: 'Cultural Studies',
                action: searchAction({ query: '', filters: { gened: 'CS' } }),
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('CS gened')
    submitSearch()

    expect(await screen.findByText(/did you mean a different interpretation/i)).toBeInTheDocument()
    await screen.findByRole('button', { name: /use cultural studies/i })
    fireEvent.click(
      screen.getByRole('button', { name: /use cultural studies/i })
    )

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: '',
        pagination: { limit: 20, offset: 0 },
        filters: expect.objectContaining({ gened: 'CS' }),
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'CS gened'
    )
  })

  it('offers recovery groups for empty searches and keeps the relaxed query through sort changes', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: {
            raw: 'class about movies no essays',
            residual: 'about movies',
          },
          fallback: {
            tierReached: 1,
            constraintsRelaxed: [],
            originalResultCount: 0,
            recoveryGroups: [
              {
                id: 'evidence-backed-workload',
                label:
                  'Show low-workload evidence when exact assignment evidence is missing',
                description:
                  'Keeps the topic while relaxing low-writing evidence.',
                relaxes: ['lowWriting'],
                keeps: ['topic'],
                action: searchAction({ query: 'class about movies' }),
              },
            ],
          },
          ui: {
            chips: [],
            advanced: {},
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'MACS-150-2026-spring',
            subject: 'MACS',
            number: '150',
            title: 'Introduction to Film',
          }),
        ])
      )
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'MACS-356-2026-spring',
            subject: 'MACS',
            number: '356',
            title: 'Film History',
            avg_gpa: 3.7,
          }),
        ])
      )

    renderSearchPage()

    setQuery('class about movies no essays')
    submitSearch()

    await screen.findByText('Nothing matched that search.')
    fireEvent.click(
      screen.getByRole('button', {
        name: /show low-workload evidence/i,
      })
    )

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'class about movies',
        pagination: { limit: 20, offset: 0 },
        filters: undefined,
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'class about movies no essays'
    )

    await screen.findByText(/MACS 150: Introduction to Film/i)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    fireEvent.click(
      screen.getByRole('button', { name: /sort by avg gpa, descending/i })
    )

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'class about movies',
        pagination: { limit: 20, offset: 0 },
        filters: undefined,
        sort: { field: 'gpa', direction: 'desc' },
      })
    })
  })

  it('keeps accepted ambiguity actions as the canonical request during sort changes', async () => {
    const culturalStudiesResponse = deferred<SearchResponseDto>()
    const sortedResponse = deferred<SearchResponseDto>()
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-100-2026-spring',
            number: '100',
            title: 'Freshman Orientation',
          }),
        ]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'CS', residual: '' },
          ui: {
            chips: [
              {
                id: 'subject-0',
                type: 'subject',
                label: 'Subject CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: '', filters: undefined }),
              },
            ],
            advanced: { subject: 'CS' },
            ambiguityActions: [
              {
                id: '0-0-gened-CS',
                term: 'CS',
                label: 'Cultural Studies',
                action: searchAction({ query: '', filters: { gened: 'CS' } }),
              },
            ],
          },
        },
      })
      .mockImplementationOnce(() => culturalStudiesResponse.promise)
      .mockImplementationOnce(() => sortedResponse.promise)

    renderSearchPage()

    setQuery('CS')
    submitSearch()

    await screen.findByRole('button', { name: /use cultural studies/i })
    fireEvent.click(
      screen.getByRole('button', { name: /use cultural studies/i })
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /use cultural studies/i })
      ).not.toBeInTheDocument()
    })
    expectLastSearchCalledWithRequest({
      query: '',
      pagination: { limit: 20, offset: 0 },
      filters: { gened: 'CS' },
    })

    await act(async () => {
      culturalStudiesResponse.resolve({
        ...searchResponse([
          course({
            id: 'ANTH-103-2026-spring',
            subject: 'ANTH',
            number: '103',
            title: 'Anthropology in a Changing World',
          }),
        ]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: '', residual: '' },
          ui: {
            chips: [
              {
                id: 'gened-0',
                type: 'gened',
                label: 'GenEd CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'CS' }),
              },
            ],
            advanced: { gened: 'CS' },
            ambiguityActions: [],
          },
        },
      })
      await culturalStudiesResponse.promise
    })

    await screen.findByText(/ANTH 103: Anthropology in a Changing World/i)
    expect(
      screen.queryByRole('button', { name: /use cultural studies/i })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    fireEvent.click(
      screen.getByRole('button', { name: /sort by avg gpa, descending/i })
    )

    expectLastSearchCalledWithRequest({
      query: '',
      pagination: { limit: 20, offset: 0 },
      filters: { gened: 'CS' },
      sort: { field: 'gpa', direction: 'desc' },
    })
    expect(screen.queryByLabelText('Searching courses')).not.toBeInTheDocument()
    expect(screen.getByText(/ANTH 103/i)).toBeInTheDocument()
    expect(screen.getByText(/updating results/i)).toBeInTheDocument()

    await act(async () => {
      sortedResponse.resolve({
        ...searchResponse([
          course({
            id: 'AFST-222-2026-spring',
            subject: 'AFST',
            number: '222',
            title: 'Introduction to Modern Africa',
            avg_gpa: 3.76,
          }),
        ]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: '', residual: '' },
          appliedSort: { field: 'gpa', direction: 'desc' },
          ui: {
            chips: [
              {
                id: 'gened-0',
                type: 'gened',
                label: 'GenEd CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'CS' }),
              },
            ],
            advanced: { gened: 'CS' },
            ambiguityActions: [],
          },
        },
      })
      await sortedResponse.promise
    })

    await screen.findByText('AFST 222')
    expect(screen.getByText('Introduction to Modern Africa')).toBeInTheDocument()
  })

  it('returns to the typed query when removing the last accepted ambiguity filter', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-100-2026-spring',
            number: '100',
            title: 'Freshman Orientation',
          }),
        ]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'CS', residual: '' },
          ui: {
            chips: [
              {
                id: 'subject-0',
                type: 'subject',
                label: 'Subject CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: '', filters: undefined }),
              },
            ],
            advanced: { subject: 'CS' },
            ambiguityActions: [
              {
                id: '0-0-gened-CS',
                term: 'CS',
                label: 'Cultural Studies',
                action: searchAction({ query: '', filters: { gened: 'CS' } }),
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'ANTH-103-2026-spring',
            subject: 'ANTH',
            number: '103',
            title: 'Anthropology in a Changing World',
          }),
        ]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: '', residual: '' },
          ui: {
            chips: [
              {
                id: 'gened-0',
                type: 'gened',
                label: 'GenEd CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'CS' }),
              },
            ],
            advanced: { gened: 'CS' },
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'CS-100-2026-spring',
            number: '100',
            title: 'Freshman Orientation',
          }),
        ])
      )

    renderSearchPage()

    setQuery('CS')
    submitSearch()

    await screen.findByRole('button', { name: /use cultural studies/i })
    fireEvent.click(
      screen.getByRole('button', { name: /use cultural studies/i })
    )
    await screen.findByText(/ANTH 103: Anthropology in a Changing World/i)

    fireEvent.click(screen.getByRole('button', { name: /remove gened cs/i }))

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'CS',
        pagination: { limit: 20, offset: 0 },
        filters: undefined,
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('CS')
  })

  it('switches ambiguity actions by clearing the competing subject or GenEd filter', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'easy cs', residual: '' },
          ui: {
            chips: [],
            advanced: { gened: 'CS', difficulty: 'easy' },
            ambiguityActions: [
              {
                id: '0-0-subject-CS',
                term: 'cs',
                label: 'Computer Science',
                action: searchAction({
                  query: '',
                  filters: { subject: 'CS', difficulty: 'easy' },
                }),
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([]))

    renderSearchPage()

    setQuery('easy cs')
    submitSearch()

    await screen.findByRole('button', { name: /use computer science/i })
    fireEvent.click(
      screen.getByRole('button', { name: /use computer science/i })
    )

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: '',
        pagination: { limit: 20, offset: 0 },
        filters: { subject: 'CS', difficulty: 'easy' },
      })
    })
  })

  it('sends advanced controls as structured filters while preserving free-text terms', async () => {
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
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'cs' },
    })
    fireEvent.change(screen.getByLabelText('Course number'), {
      target: { value: '225' },
    })
    fireEvent.change(screen.getByLabelText('Instructor'), {
      target: { value: 'Fagen' },
    })
    fireEvent.change(screen.getByLabelText('Credits'), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Level' }))
    fireEvent.click(await screen.findByRole('option', { name: '400 level' }))
    fireEvent.click(screen.getByLabelText('Include past terms'))
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'algorithms',
        pagination: { limit: 20, offset: 0 },
        filters: expect.objectContaining({
          subject: 'CS',
          number: '225',
          instructor: 'Fagen',
          credits: 4,
          level: 400,
        }),
        scope: 'all',
        sort: { field: 'relevance', direction: 'desc' },
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'algorithms'
    )
  })

  it('clears stale search text when advanced filters contradict parsed query filters', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'intro to CS', residual: 'intro to' },
          ui: {
            chips: [
              {
                id: 'subject-0',
                type: 'subject',
                label: 'Subject CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'intro to' }),
              },
            ],
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
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'PHIL' },
    })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: '',
        pagination: { limit: 20, offset: 0 },
        filters: expect.objectContaining({ subject: 'PHIL' }),
      })
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
            chips: [
              {
                id: 'subject-0',
                type: 'subject',
                label: 'Subject CS',
                value: 'CS',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'algorithms' }),
              },
            ],
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
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'PHIL' },
    })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: 'algorithms',
        pagination: { limit: 20, offset: 0 },
        filters: expect.objectContaining({ subject: 'PHIL' }),
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'algorithms'
    )
  })

  it('keeps advanced apply disabled until filters differ from the interpreted query', async () => {
    vi.mocked(api.search).mockResolvedValueOnce({
      ...searchResponse([]),
      meta: {
        ...searchResponse([]).meta,
        query: { raw: 'intro to CS', residual: 'intro to' },
        ui: {
          chips: [
            {
              id: 'subject-0',
              type: 'subject',
              label: 'Subject CS',
              value: 'CS',
              source: 'natural_language',
              removable: true,
              editable: true,
              action: searchAction({ query: 'intro to' }),
            },
          ],
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
    expect(
      screen.getByRole('button', { name: /apply filters/i })
    ).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'PHIL' },
    })
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /reset fields/i }))
    expect(screen.getByLabelText('Subject')).toHaveValue('CS')
    expect(
      screen.getByRole('button', { name: /apply filters/i })
    ).toBeDisabled()
  })

  it('loads more from the refined query without changing the visible search text', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([]),
        meta: {
          ...searchResponse([]).meta,
          query: { raw: 'professor fagen algorithms', residual: 'algorithms' },
          ui: {
            chips: [
              {
                id: 'instructor-0',
                type: 'instructor',
                label: 'Instructor fagen',
                value: 'fagen',
                source: 'natural_language',
                removable: true,
                editable: true,
                action: searchAction({ query: 'algorithms' }),
              },
            ],
            advanced: { instructor: 'fagen' },
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-374-2026-spring',
            number: '374',
            title: 'Introduction to Algorithms',
          }),
        ]),
        pagination: {
          total: 21,
          limit: 20,
          offset: 0,
          hasMore: true,
          nextOffset: 20,
        },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-473-2026-spring',
            number: '473',
            title: 'Algorithms',
          }),
        ]),
        pagination: {
          total: 21,
          limit: 20,
          offset: 20,
          hasMore: false,
          nextOffset: null,
        },
      })

    renderSearchPage()

    setQuery('professor fagen algorithms')
    submitSearch()

    await screen.findByText('Instructor fagen')
    fireEvent.click(
      screen.getByRole('button', { name: /remove instructor fagen/i })
    )

    await screen.findByText(/CS 374: Introduction to Algorithms/i)
    fireEvent.click(screen.getByRole('button', { name: /show more results/i }))

    await screen.findByText(/CS 473: Algorithms/i)
    expectLastSearchCalledWithRequest({
      query: 'algorithms',
      pagination: { limit: 20, offset: 20 },
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'professor fagen algorithms'
    )
  })

  it('loads the next page of results without replacing the current page', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-100-2026-spring',
            number: '100',
            title: 'Freshman Orientation',
          }),
        ]),
        pagination: {
          total: 21,
          limit: 20,
          offset: 0,
          hasMore: true,
          nextOffset: 20,
        },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-124-2026-spring',
            number: '124',
            title: 'Introduction to Computer Science I',
          }),
        ]),
        pagination: {
          total: 21,
          limit: 20,
          offset: 20,
          hasMore: false,
          nextOffset: null,
        },
      })

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()

    await screen.findByText(/CS 100: Freshman Orientation/i)
    fireEvent.click(screen.getByRole('button', { name: /show more results/i }))

    await screen.findByText(/CS 124: Introduction to Computer Science I/i)
    expect(
      screen.getByText(/CS 100: Freshman Orientation/i)
    ).toBeInTheDocument()
    expectLastSearchCalledWithRequest({
      query: 'intro to CS',
      pagination: { limit: 20, offset: 20 },
    })
  })

  it('falls back to offset plus limit when a hasMore page omits nextOffset', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-100-2026-spring',
            number: '100',
            title: 'Freshman Orientation',
          }),
        ]),
        pagination: { total: 21, limit: 20, offset: 0, hasMore: true },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-101-2026-spring',
            number: '101',
            title: 'Intro Computing',
          }),
        ]),
        pagination: { total: 22, limit: 20, offset: 20, hasMore: true },
      })

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()

    await screen.findByText(/CS 100: Freshman Orientation/i)
    fireEvent.click(screen.getByRole('button', { name: /show more results/i }))

    await screen.findByText(/CS 101: Intro Computing/i)
    expectLastSearchCalledWithRequest({
      query: 'intro to CS',
      pagination: { limit: 20, offset: 20 },
    })
  })
})
