import axe from 'axe-core'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDetailResponseDto } from '@warlock-v2/query-types'
import App from '../App'
import { api } from '../lib/api-client'
import { TestUiProvider } from '../test/TestUiProvider'

vi.mock('../lib/api-client', () => ({
  api: {
    search: vi.fn(),
    getCourse: vi.fn(),
    getTermOptions: vi.fn(async () => ({ terms: [] })),
  },
}))

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
    links: {},
    sections: [],
  },
}

async function expectAccessible(container: HTMLElement) {
  const result = await axe.run(container)
  expect(result.violations.map(({ id }) => id)).toEqual([])
}

afterEach(cleanup)

describe('public page accessibility', () => {
  it('keeps the app shell and search route free of automated violations', async () => {
    const { container } = render(
      <TestUiProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </TestUiProvider>
    )
    await expectAccessible(container)
  })

  it('keeps a rendered course free of automated violations', async () => {
    vi.mocked(api.getCourse).mockResolvedValue(detail)
    const { container } = render(
      <TestUiProvider>
        <MemoryRouter initialEntries={['/course/CS/225?term=spring&year=2026']}>
          <App />
        </MemoryRouter>
      </TestUiProvider>
    )
    await screen.findByRole('heading', { name: /CS 225:/i })
    await expectAccessible(container)
  })
})
