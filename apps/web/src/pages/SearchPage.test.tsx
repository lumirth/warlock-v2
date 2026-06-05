import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SearchResponseDto } from '@uiuc-course-search/query-types'
import {
  abortError,
  api,
  course,
  deferred,
  expectLastSearchCalledWithRequest,
  expectSearchCalledWithRequest,
  renderSearchPage,
  searchResponse,
  setQuery,
  submitSearch,
} from './SearchPage.test-utils'

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
          search: { score: 0.91 },
          matchEvidence: [
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

  it('surfaces quality, workload, instructor rating, and GPA on result cards', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'CS-225-2026-spring',
            number: '225',
            title: 'Data Structures',
            metrics: {
              qualityScore: 88,
              workloadScore: 42,
              primaryInstructorRating: 4.8,
              avgGpa: 3.62,
              gpaSampleSize: 820,
            },
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
            metrics: {
              qualityScore: 88,
              workloadScore: 42,
              primaryInstructorRating: 4.8,
              avgGpa: 3.62,
              gpaSampleSize: 820,
            },
          }),
        ], 'online stats class')
      )
      .mockResolvedValueOnce(
        searchResponse([
          course({
            id: 'STAT-100-2026-spring',
            subject: 'STAT',
            number: '100',
            title: 'Statistics',
            metrics: { avgGpa: 3.82 },
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
          search: { historical: true, score: 0.81 },
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
})
