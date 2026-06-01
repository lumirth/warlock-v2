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
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    setQuery('second')
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await act(async () => {
      first.reject(abortError())
      await first.promise.catch(() => undefined)
    })

    setQuery('third')
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

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
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    await screen.findByText(/CS 225: Data Structures/i)

    setQuery('broken')
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Search failed/i)
    await waitFor(() => {
      expect(screen.queryByText(/CS 225: Data Structures/i)).not.toBeInTheDocument()
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
