import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { CourseDetailResponseDto } from '@warlock-v2/query-types'
import { api } from '../lib/api-client'
import { CoursePage } from './CoursePage'

vi.mock('../lib/api-client', () => ({ api: { getCourse: vi.fn() } }))

const detail: CourseDetailResponseDto = {
  course: {
    id: 'CS-225-2026-spring',
    subject: 'CS',
    number: '225',
    title: 'Data Structures',
    description: 'A course',
    creditHours: 4,
    creditHoursText: '4 hours.',
    year: 2026,
    term: 'spring',
    primaryInstructor: 'Lovelace, A',
    metrics: {
      primaryInstructorRating: 4.8,
      avgGpa: 3.62,
      gpaSampleSize: 820,
      qualityScore: 88,
      instructorDifficultyScore: 42,
    },
    catalog: { courseInfo: null, degreeAttributes: null },
    scheduleNotes: { classScheduleInfo: null, dateRangeText: null },
    registration: { registrationNotes: null, approvalCode: null },
    requirements: [],
    links: { courseExplorerUrl: 'https://courses.illinois.edu/CS/225' },
    sections: [],
  },
}

it('loads and renders the selected course while preserving the return URL', async () => {
  vi.mocked(api.getCourse).mockResolvedValue(detail)
  const router = createMemoryRouter(
    [
      { path: '/course/:subject/:number', element: <CoursePage /> },
      { path: '/', element: <p>Search</p> },
    ],
    {
      initialEntries: [
        {
          pathname: '/course/CS/225',
          search: '?term=spring&year=2026',
          state: { returnTo: '/?q=data+structures&subject=CS' },
        },
      ],
    }
  )
  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /CS 225:/i })).toBeVisible()
  expect(screen.getByText('Lovelace, A')).toBeVisible()
  expect(
    screen.getByRole('link', { name: /official course listing/i })
  ).toHaveAttribute('href', detail.course.links.courseExplorerUrl)
  expect(screen.getByRole('link', { name: /back to search/i })).toHaveAttribute(
    'href',
    '/?q=data+structures&subject=CS'
  )
  expect(api.getCourse).toHaveBeenCalledWith(
    'CS',
    '225',
    'spring',
    2026,
    expect.any(AbortSignal)
  )
})
