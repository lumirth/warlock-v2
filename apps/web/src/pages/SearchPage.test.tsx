import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SearchCourseResultDto,
  SearchRequestDto,
  SearchResponseDto,
} from '@warlock-v2/query-types'
import { TestUiProvider } from '../test/TestUiProvider'
import { SearchPage } from './SearchPage'

const api = vi.hoisted(() => ({
  search: vi.fn(),
  getTermOptions: vi.fn(async () => ({ terms: [] })),
}))
vi.mock('../lib/api-client', () => ({ api }))

const course = (
  number = '225',
  title = 'Data Structures'
): SearchCourseResultDto => ({
  course: {
    id: `CS-${number}-2026-spring`,
    subject: 'CS',
    number,
    title,
    description: 'A course',
    creditHours: 4,
    creditHoursText: '4 hours.',
    year: 2026,
    term: 'spring',
    primaryInstructor: null,
    metrics: {
      primaryInstructorRating: null,
      avgGpa: null,
      gpaSampleSize: null,
      qualityScore: null,
      instructorDifficultyScore: null,
    },
    catalog: { courseInfo: null, degreeAttributes: null },
    scheduleNotes: { classScheduleInfo: null, dateRangeText: null },
    registration: { registrationNotes: null, approvalCode: null },
    requirements: [],
    links: {},
  },
})

function response(
  results: SearchCourseResultDto[],
  request: SearchRequestDto,
  pagination: Partial<SearchResponseDto['pagination']> = {}
): SearchResponseDto {
  return {
    results,
    meta: {
      nextRequest: request,
      interpretedRequest: request,
      ui: { chips: [], ambiguityActions: [] },
    },
    pagination: {
      totalResults: results.length,
      browseableResults: results.length,
      limit: 20,
      offset: 0,
      ...pagination,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function renderAt(entry = '/') {
  return render(
    <TestUiProvider>
      <MemoryRouter initialEntries={[entry]}>
        <SearchPage />
      </MemoryRouter>
    </TestUiProvider>
  )
}

function submit(query: string) {
  fireEvent.change(screen.getByLabelText(/course search query/i), {
    target: { value: query },
  })
  fireEvent.submit(screen.getByRole('search'))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('URL-owned search', () => {
  it('cancels superseded work and ignores its stale response', async () => {
    const first = deferred<SearchResponseDto>()
    const second = deferred<SearchResponseDto>()
    let signal: AbortSignal | undefined
    api.search
      .mockImplementationOnce((_request, options) => {
        signal = options.signal
        return first.promise
      })
      .mockImplementationOnce(() => second.promise)

    renderAt()
    submit('first')
    submit('second')
    expect(signal?.aborted).toBe(true)

    await act(async () =>
      second.resolve(
        response([course('100', 'Statistics')], { query: 'second' })
      )
    )
    expect(await screen.findByText(/CS 100: Statistics/i)).toBeVisible()
    await act(async () =>
      first.resolve(response([course()], { query: 'first' }))
    )
    expect(
      screen.queryByText(/CS 225: Data Structures/i)
    ).not.toBeInTheDocument()
  })

  it('restores searches as browser history moves', async () => {
    api.search.mockResolvedValue(response([course()], { query: 'cs 225' }))
    const router = createMemoryRouter(
      [{ path: '/', element: <SearchPage /> }],
      { initialEntries: ['/', '/?q=cs+225'], initialIndex: 1 }
    )
    render(
      <TestUiProvider>
        <RouterProvider router={router} />
      </TestUiProvider>
    )

    expect(await screen.findByText(/CS 225: Data Structures/i)).toBeVisible()
    await act(async () => router.navigate(-1))
    await waitFor(() =>
      expect(screen.getByLabelText(/course search query/i)).toHaveValue('')
    )
    expect(screen.queryByText(/CS 225:/i)).not.toBeInTheDocument()
    await act(async () => router.navigate(1))
    await waitFor(() =>
      expect(screen.getByLabelText(/course search query/i)).toHaveValue(
        'cs 225'
      )
    )
    expect(api.search).toHaveBeenCalledTimes(2)
  })

  it('commits filters to the URL and appends the requested page', async () => {
    api.search
      .mockResolvedValueOnce(
        response(
          [course()],
          {
            query: 'algorithms',
            filters: { subject: 'CS' },
          },
          {
            totalResults: 2,
            browseableResults: 2,
            hasMore: true,
          }
        )
      )
      .mockResolvedValueOnce(
        response(
          [course('173', 'Discrete Structures')],
          {
            query: 'algorithms',
            filters: { subject: 'CS' },
            pagination: { limit: 20, offset: 20 },
          },
          { totalResults: 2, browseableResults: 2, offset: 20 }
        )
      )
    const router = createMemoryRouter([{ path: '/', element: <SearchPage /> }])
    render(
      <TestUiProvider>
        <RouterProvider router={router} />
      </TestUiProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'CS' },
    })
    fireEvent.change(screen.getByLabelText(/course search query/i), {
      target: { value: 'algorithms' },
    })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))
    await waitFor(() =>
      expect(router.state.location.search).toContain('subject=CS')
    )
    fireEvent.click(await screen.findByRole('button', { name: /show more/i }))

    expect(
      await screen.findByText(/CS 173: Discrete Structures/i)
    ).toBeVisible()
    expect(api.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ subject: 'CS' }),
        pagination: { limit: 20, offset: 20 },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(screen.getByText('Showing 2')).toBeVisible()
  })

  it('reports a malformed shared link without issuing a request', async () => {
    renderAt('/?subject=C')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be restored/i
    )
    expect(api.search).not.toHaveBeenCalled()
  })

  it('keeps an interpreted course query when applying advanced filters', async () => {
    const initial = response([course()], { query: 'CS 225' })
    initial.meta.interpretedRequest = {
      query: '', filters: { subject: 'CS', number: '225' },
    }
    api.search
      .mockResolvedValueOnce(initial)
      .mockImplementation(async (request: SearchRequestDto) => response(
        request.query === 'CS 225' ? [course()] : [course('173', 'Discrete Structures')],
        request,
      ))
    const router = createMemoryRouter(
      [{ path: '/', element: <SearchPage /> }],
      { initialEntries: ['/?q=CS+225'] },
    )
    render(<TestUiProvider><RouterProvider router={router} /></TestUiProvider>)

    expect(await screen.findByText(/CS 225: Data Structures/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /advanced search/i }))
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    expect(await screen.findByText(/CS 225: Data Structures/i)).toBeVisible()
    expect(screen.getByLabelText(/course search query/i)).toHaveValue('CS 225')
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('CS 225')
    expect(new URLSearchParams(router.state.location.search).get('level')).toBe('200')
    expect(screen.queryByText(/CS 173: Discrete Structures/i)).not.toBeInTheDocument()
  })
})
