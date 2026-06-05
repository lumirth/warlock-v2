import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  api,
  course,
  expectLastSearchCalledWithRequest,
  renderSearchPage,
  searchAction,
  searchResponse,
  setQuery,
  submitSearch,
} from './SearchPage.test-utils'

describe('SearchPage advanced filters and pagination', () => {
  it('runs advanced filters from the homepage with available years from the API', async () => {
    vi.mocked(api.getTermOptions).mockResolvedValueOnce({
      terms: [
        {
          termId: '2026-fall',
          term: 'fall',
          year: 2026,
          status: 'registrable',
          label: 'Fall 2026',
        },
      ],
      years: [2027, 2026],
    })
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([], 'fixture'))

    renderSearchPage()

    await screen.findByText('Search filters')
    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'cs' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Year' }))
    fireEvent.click(await screen.findByRole('option', { name: '2026' }))
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: '',
        pagination: { limit: 20, offset: 0 },
        filters: expect.objectContaining({
          subject: 'CS',
          year: 2026,
        }),
      })
    })
  })

  it('defaults multiple GenEd selections to all selected', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(searchResponse([], 'fixture'))

    renderSearchPage()

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose geneds/i }))
    fireEvent.click(screen.getByLabelText(/Advanced Composition/i))
    fireEvent.click(screen.getByLabelText(/Humanities & the Arts/i))
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expectLastSearchCalledWithRequest({
        query: '',
        pagination: { limit: 20, offset: 0 },
        filters: expect.objectContaining({
          requirement: {
            mode: 'all',
            codes: expect.arrayContaining(['ACP', 'HUM']),
          },
        }),
      })
    })
  })

  it('sends advanced controls as structured filters while preserving free-text terms', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          query: { raw: 'algorithms', residual: 'algorithms' },
          nextRequest: {
            query: 'algorithms',
          },
          ui: {
            chips: [],
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([], 'fixture'))

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
    fireEvent.click(screen.getByRole('combobox', { name: 'Credits' }))
    fireEvent.click(await screen.findByRole('option', { name: '4 credits' }))
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
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          query: { raw: 'intro to CS', residual: 'intro to' },
          nextRequest: {
            query: 'intro to CS',
          },
          interpretedRequest: {
            query: '',
            filters: { subject: 'CS' },
          },
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
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([], 'fixture'))

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
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          query: { raw: 'CS algorithms', residual: 'algorithms' },
          nextRequest: {
            query: 'CS algorithms',
          },
          interpretedRequest: {
            query: 'algorithms',
            filters: { subject: 'CS' },
          },
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
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([], 'fixture'))

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

  it('adopts interpreted filters only through the explicit advanced reset action', async () => {
    vi.mocked(api.search).mockResolvedValueOnce({
      ...searchResponse([], 'fixture'),
      meta: {
        ...searchResponse([], 'fixture').meta,
        query: { raw: 'intro to CS', residual: 'intro to' },
        nextRequest: {
          query: 'intro to CS',
        },
        interpretedRequest: {
          query: '',
          filters: { subject: 'CS' },
        },
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
          ambiguityActions: [],
        },
      },
    })

    renderSearchPage()

    setQuery('intro to CS')
    submitSearch()
    await screen.findByText('Subject CS')

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /reset fields/i }))
    expect(screen.getByLabelText('Subject')).toHaveValue('CS')
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
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          query: { raw: 'professor fagen algorithms', residual: 'algorithms' },
          nextRequest: {
            query: 'professor fagen algorithms',
          },
          interpretedRequest: {
            query: 'algorithms',
            filters: { instructor: 'fagen' },
          },
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
        ], 'algorithms'),
        pagination: {
          totalResults: 21,
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
        ], 'algorithms'),
        pagination: {
          totalResults: 21,
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
        ], 'intro to CS'),
        pagination: {
          totalResults: 21,
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
        ], 'intro to CS'),
        pagination: {
          totalResults: 21,
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
        ], 'intro to CS'),
        pagination: { totalResults: 21, limit: 20, offset: 0, hasMore: true },
      })
      .mockResolvedValueOnce({
        ...searchResponse([
          course({
            id: 'CS-101-2026-spring',
            number: '101',
            title: 'Intro Computing',
          }),
        ], 'intro to CS'),
        pagination: { totalResults: 22, limit: 20, offset: 20, hasMore: true },
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
