import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { CoursePage } from './CoursePage'

vi.mock('../lib/api-client', () => ({
  api: {
    getCourse: vi.fn(),
  },
}))

function course(overrides: Partial<CourseDto> = {}): CourseDto {
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
    sections: [],
    ...overrides,
  }
}

function renderCoursePage(initialEntry: string) {
  const router = createMemoryRouter([
    { path: '/course/:subject/:number', element: <CoursePage /> },
    { path: '/', element: <div /> },
  ], { initialEntries: [initialEntry] })

  render(
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>
  )

  return router
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CoursePage request state', () => {
  it('refetches when only term or year query params change', async () => {
    vi.mocked(api.getCourse)
      .mockResolvedValueOnce(course({ id: 'CS-225-2026-fall', term: 'fall' }))
      .mockResolvedValueOnce(course({ id: 'CS-225-2026-spring', term: 'spring' }))

    const router = renderCoursePage('/course/CS/225?term=fall&year=2026')

    await screen.findByText(/fall 2026/i)

    await router.navigate('/course/CS/225?term=spring&year=2026')

    await screen.findByText(/spring 2026/i)
    await waitFor(() => {
      expect(api.getCourse).toHaveBeenCalledTimes(2)
    })
    expect(api.getCourse).toHaveBeenNthCalledWith(1, 'CS', '225', 'fall', 2026, expect.any(AbortSignal))
    expect(api.getCourse).toHaveBeenNthCalledWith(2, 'CS', '225', 'spring', 2026, expect.any(AbortSignal))
  })
})
