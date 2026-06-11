import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  singleRequirementFilter,
  type SearchResponseDto,
} from '@uiuc-course-search/query-types'
import {
  api,
  course,
  deferred,
  expectLastSearchCalledWithRequest,
  renderSearchPage,
  searchResponse,
  setQuery,
  submitSearch,
} from './SearchPage.test-utils'

describe('SearchPage refinements and ambiguity actions', () => {
  it('lets users remove interpreted search chips and reruns the edited query', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
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
                removeRequest: ({ query: 'algorithms' }),
              },
            ],
            ambiguityActions: [],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([], 'fixture'))

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
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: 'CS gened',
          },
          interpretedRequest: {
            query: '',
            filters: { subject: 'CS' },
          },
          ui: {
            chips: [],
            ambiguityActions: [
              {
                id: '0-0-requirement-CS',
                term: 'CS',
                label: 'Cultural Studies',
                nextRequest: ({ query: '', filters: { requirement: singleRequirementFilter('CS') } }),
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([], 'fixture'))

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
        filters: expect.objectContaining({ requirement: singleRequirementFilter('CS') }),
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'CS gened'
    )
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
        ], 'CS'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: 'CS',
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
                removeRequest: ({ query: '', filters: undefined }),
              },
            ],
            ambiguityActions: [
              {
                id: '0-0-requirement-CS',
                term: 'CS',
                label: 'Cultural Studies',
                nextRequest: ({ query: '', filters: { requirement: singleRequirementFilter('CS') } }),
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
      filters: { requirement: singleRequirementFilter('CS') },
      scope: 'active',
      sort: { field: 'relevance', direction: 'desc' },
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
        ], { query: '', filters: { requirement: singleRequirementFilter('CS') } }),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: '',
            filters: { requirement: singleRequirementFilter('CS') },
          },
          ui: {
            chips: [
              {
                id: 'requirement-0',
                type: 'requirement',
                label: 'GenEd CS',
                value: 'CS',
                removeRequest: ({ query: 'CS' }),
              },
            ],
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
      filters: { requirement: singleRequirementFilter('CS') },
      scope: 'active',
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
            metrics: { avgGpa: 3.76 },
          }),
        ], {
          query: '',
          filters: { requirement: singleRequirementFilter('CS') },
          sort: { field: 'gpa', direction: 'desc' },
        }),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: '',
            filters: { requirement: singleRequirementFilter('CS') },
            sort: { field: 'gpa', direction: 'desc' },
          },
          ui: {
            chips: [
              {
                id: 'requirement-0',
                type: 'requirement',
                label: 'GenEd CS',
                value: 'CS',
                removeRequest: ({ query: 'CS' }),
              },
            ],
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
        ], 'CS'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: 'CS',
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
                removeRequest: ({ query: '', filters: undefined }),
              },
            ],
            ambiguityActions: [
              {
                id: '0-0-requirement-CS',
                term: 'CS',
                label: 'Cultural Studies',
                nextRequest: ({ query: '', filters: { requirement: singleRequirementFilter('CS') } }),
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
        ], { query: '', filters: { requirement: singleRequirementFilter('CS') } }),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: '',
            filters: { requirement: singleRequirementFilter('CS') },
          },
          ui: {
            chips: [
              {
                id: 'requirement-0',
                type: 'requirement',
                label: 'GenEd CS',
                value: 'CS',
                removeRequest: ({ query: 'CS' }),
              },
            ],
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
        ], 'CS')
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
        filters: {},
        scope: 'active',
        sort: { field: 'relevance', direction: 'desc' },
      })
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('CS')
  })

  it('switches ambiguity actions by clearing the competing subject or requirement filter', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce({
        ...searchResponse([], 'fixture'),
        meta: {
          ...searchResponse([], 'fixture').meta,
          nextRequest: {
            query: 'easy cs',
          },
          interpretedRequest: {
            query: '',
            filters: { requirement: singleRequirementFilter('CS'), workload: 'easy' },
          },
          ui: {
            chips: [],
            ambiguityActions: [
              {
                id: '0-0-subject-CS',
                term: 'cs',
                label: 'Computer Science',
                nextRequest: ({
                  query: '',
                  filters: { subject: 'CS', workload: 'easy' },
                }),
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce(searchResponse([], 'fixture'))

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
        filters: { subject: 'CS', workload: 'easy' },
        scope: 'active',
        sort: { field: 'relevance', direction: 'desc' },
      })
    })
  })
})
