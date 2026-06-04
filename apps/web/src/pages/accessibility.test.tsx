import axe from 'axe-core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { TestUiProvider } from '../test/TestUiProvider'
import { SearchPage } from './SearchPage'
import { CoursePage } from './CoursePage'
import App from '../App'

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
    year: 2026,
    term: 'spring',
    primary_instructor: 'Lovelace, A',
    primary_instructor_rmp: 4.8,
    avg_gpa: 3.62,
    median_gpa: null,
    gpa_sample_size: 820,
    quality_score: 88,
    difficulty_score: 42,
    course_info: null,
    degree_attributes: null,
    class_schedule_info: null,
    date_range_text: null,
    registration_notes: null,
    approval_code: null,
    geneds: [
      {
        categoryId: 'QR',
        categoryName: 'Quantitative Reasoning',
        attributeCode: null,
        attributeName: null,
      },
    ],
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
  expect(result.violations.map((violation) => violation.id)).toEqual([])
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('page accessibility', () => {
  it('keeps the app shell free of automated accessibility violations', async () => {
    const { container } = render(
      <TestUiProvider>
        <RouterProvider
          router={createMemoryRouter([{ path: '*', element: <App /> }])}
        />
      </TestUiProvider>
    )

    await expectNoA11yViolations(container)
  })

  it('keeps the search page free of automated accessibility violations', async () => {
    const { container } = render(
      <TestUiProvider>
        <RouterProvider
          router={createMemoryRouter([{ path: '/', element: <SearchPage /> }])}
        />
      </TestUiProvider>
    )

    await expectNoA11yViolations(container)
  })

  it('keeps the search table view free of automated accessibility violations', async () => {
    window.localStorage.setItem('uiuc-course-search.result-view', 'table')
    vi.mocked(api.search).mockResolvedValueOnce({
      results: [course()],
      meta: {
        query: { raw: 'cs 225', residual: 'cs 225' },
        timing: { extraction_ms: 1, search_ms: 2, total_ms: 3 },
        appliedSort: { field: 'relevance', direction: 'desc' },
        appliedScope: 'active',
      },
      pagination: { total: 1, limit: 20, offset: 0 },
    })

    const { container } = render(
      <TestUiProvider>
        <RouterProvider
          router={createMemoryRouter([{ path: '/', element: <SearchPage /> }])}
        />
      </TestUiProvider>
    )

    fireEvent.change(screen.getByLabelText(/course search query/i), {
      target: { value: 'cs 225' },
    })
    fireEvent.submit(screen.getByRole('search'))

    await screen.findByRole('table')
    await expectNoA11yViolations(container)
  }, 15000)

  it('keeps the course detail page free of automated accessibility violations', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(course())

    const { container } = render(
      <TestUiProvider>
        <RouterProvider
          router={createMemoryRouter(
            [
              { path: '/course/:subject/:number', element: <CoursePage /> },
              { path: '/', element: <div /> },
            ],
            { initialEntries: ['/course/CS/225?term=spring&year=2026'] }
          )}
        />
      </TestUiProvider>
    )

    await screen.findByText(/CS 225: Data Structures/i)
    await expectNoA11yViolations(container)
  })
})
