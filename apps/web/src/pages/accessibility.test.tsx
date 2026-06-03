import axe from 'axe-core'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { TestMantineProvider } from '../test/TestMantineProvider'
import { SearchPage } from './SearchPage'
import { CoursePage } from './CoursePage'

vi.mock('../lib/api-client', () => ({
  api: {
    search: vi.fn(),
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
    gened: 'QR',
    year: 2026,
    term: 'spring',
    primary_instructor: 'Lovelace, A',
    primary_instructor_rmp: 4.8,
    avg_gpa: 3.62,
    gpa_sample_size: 820,
    quality_score: 88,
    difficulty_score: 42,
    instructor_links: {},
    sections: [],
    ...overrides,
  }
}

async function expectNoA11yViolations(container: HTMLElement): Promise<void> {
  const result = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
    },
  })
  expect(result.violations.map(violation => violation.id)).toEqual([])
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('page accessibility', () => {
  it('keeps the search page free of automated accessibility violations', async () => {
    const { container } = render(
      <TestMantineProvider>
        <RouterProvider router={createMemoryRouter([{ path: '/', element: <SearchPage /> }])} />
      </TestMantineProvider>
    )

    await expectNoA11yViolations(container)
  })

  it('keeps the course detail page free of automated accessibility violations', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(course())

    const { container } = render(
      <TestMantineProvider>
        <RouterProvider router={createMemoryRouter([
          { path: '/course/:subject/:number', element: <CoursePage /> },
          { path: '/', element: <div /> },
        ], { initialEntries: ['/course/CS/225?term=spring&year=2026'] })} />
      </TestMantineProvider>
    )

    await screen.findByText(/CS 225: Data Structures/i)
    await expectNoA11yViolations(container)
  })
})
