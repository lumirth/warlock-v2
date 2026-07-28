import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { SearchResponseDto } from '@uiuc-course-search/query-types'
import { TestUiProvider } from '../test/TestUiProvider'
import {
  api,
  course,
  deferred,
  renderSearchPage,
  searchPageElement,
  searchResponse,
  setQuery,
  submitSearch,
} from './SearchPage.test-utils'

describe('SearchPage URL state', () => {
  it('restores a shareable search request and result view from the URL', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(
      searchResponse([course()], {
        query: 'data structures',
        filters: { subject: 'CS' },
        sort: { field: 'gpa', direction: 'desc' },
      })
    )

    renderSearchPage(
      '/?q=data+structures&subject=CS&sort=gpa&direction=desc&view=table'
    )

    await waitFor(() => {
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'data structures',
          filters: expect.objectContaining({ subject: 'CS' }),
          sort: { field: 'gpa', direction: 'desc' },
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })
    expect(screen.getByLabelText(/course search query/i)).toHaveValue(
      'data structures'
    )
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('explains malformed search links instead of crashing', async () => {
    renderSearchPage('/?subject=C')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /that search link is not valid/i
    )
    expect(screen.getByText(/could not be restored/i)).toBeInTheDocument()
    expect(api.search).not.toHaveBeenCalled()
  })

  it('restores state when browser history moves between searches', async () => {
    vi.mocked(api.search)
      .mockResolvedValueOnce(searchResponse([course()], 'cs 225'))
      .mockResolvedValueOnce(searchResponse([course()], 'cs 225'))
    const router = createMemoryRouter(
      [{ path: '/', element: searchPageElement() }],
      {
        initialEntries: ['/', '/?q=cs+225'],
        initialIndex: 1,
      }
    )

    render(
      <TestUiProvider>
        <RouterProvider router={router} />
      </TestUiProvider>
    )

    await screen.findByText(/CS 225: Data Structures/i)
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('cs 225')

    await router.navigate(-1)
    await waitFor(() => {
      expect(screen.getByLabelText(/course search query/i)).toHaveValue('')
    })
    expect(
      screen.queryByText(/CS 225: Data Structures/i)
    ).not.toBeInTheDocument()

    await router.navigate(1)
    await waitFor(() => {
      expect(screen.getByLabelText(/course search query/i)).toHaveValue(
        'cs 225'
      )
    })
    expect(api.search).toHaveBeenCalledTimes(2)
  })

  it('cancels an in-flight search when browser history returns to an empty URL', async () => {
    const pending = deferred<SearchResponseDto>()
    let searchSignal: AbortSignal | undefined
    vi.mocked(api.search).mockImplementationOnce((_request, options) => {
      searchSignal = options?.signal
      return pending.promise
    })
    const router = createMemoryRouter(
      [{ path: '/', element: searchPageElement() }],
      {
        initialEntries: ['/', '/?q=cs+225'],
        initialIndex: 1,
      }
    )

    render(
      <TestUiProvider>
        <RouterProvider router={router} />
      </TestUiProvider>
    )

    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))
    await act(async () => {
      await router.navigate(-1)
    })

    await waitFor(() => {
      expect(screen.getByLabelText(/course search query/i)).toHaveValue('')
    })
    expect(searchSignal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(searchResponse([course()], 'cs 225'))
      await pending.promise
    })

    expect(router.state.location.search).toBe('')
    expect(
      screen.queryByText(/CS 225: Data Structures/i)
    ).not.toBeInTheDocument()
  })

  it('cancels an in-flight search when navigation leaves the search page', async () => {
    const pending = deferred<SearchResponseDto>()
    let searchSignal: AbortSignal | undefined
    vi.mocked(api.search).mockImplementationOnce((_request, options) => {
      searchSignal = options?.signal
      return pending.promise
    })
    const router = createMemoryRouter(
      [
        { path: '/', element: searchPageElement() },
        { path: '/course/:subject/:number', element: <p>Course route</p> },
      ],
      { initialEntries: ['/?q=cs+225'] }
    )

    render(
      <TestUiProvider>
        <RouterProvider router={router} />
      </TestUiProvider>
    )

    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))
    await act(async () => {
      await router.navigate('/course/CS/225')
    })
    expect(searchSignal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve(searchResponse([course()], 'cs 225'))
      await pending.promise
    })

    expect(router.state.location.pathname).toBe('/course/CS/225')
    expect(screen.getByText('Course route')).toBeInTheDocument()
  })

  it('processes an external URL that overtakes a pending internal URL update', async () => {
    const first = deferred<SearchResponseDto>()
    vi.mocked(api.search)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(searchResponse([course()], 'statistics'))
    const router = createMemoryRouter(
      [{ path: '/', element: searchPageElement() }],
      { initialEntries: ['/'] }
    )

    render(
      <TestUiProvider>
        <RouterProvider router={router} />
      </TestUiProvider>
    )

    setQuery('cs 225')
    submitSearch()
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1))

    await act(async () => {
      first.resolve(searchResponse([course()], 'cs 225'))
      await first.promise
      await router.navigate('/?q=statistics')
    })

    await waitFor(() => {
      expect(api.search).toHaveBeenCalledTimes(2)
      expect(screen.getByLabelText(/course search query/i)).toHaveValue(
        'statistics'
      )
    })
    expect(router.state.location.search).toBe('?q=statistics')
  })
})
