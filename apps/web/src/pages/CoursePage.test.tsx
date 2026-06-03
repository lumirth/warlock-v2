import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseDto } from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { TestUiProvider } from '../test/TestUiProvider'
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
    primary_instructor_rmp: null,
    avg_gpa: null,
    median_gpa: null,
    gpa_sample_size: null,
    quality_score: null,
    difficulty_score: null,
    course_info: null,
    degree_attributes: null,
    class_schedule_info: null,
    date_range_text: null,
    registration_notes: null,
    approval_code: null,
    geneds: [],
    instructor_links: {},
    sections: [],
    ...overrides,
  }
}

function renderCoursePage(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: '/course/:subject/:number', element: <CoursePage /> },
      { path: '/', element: <div /> },
    ],
    { initialEntries: [initialEntry] }
  )

  render(
    <TestUiProvider>
      <RouterProvider router={router} />
    </TestUiProvider>
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
      .mockResolvedValueOnce(
        course({ id: 'CS-225-2026-spring', term: 'spring' })
      )

    const router = renderCoursePage('/course/CS/225?term=fall&year=2026')

    await screen.findByText(/fall 2026/i)

    await router.navigate('/course/CS/225?term=spring&year=2026')

    await screen.findByText(/spring 2026/i)
    await waitFor(() => {
      expect(api.getCourse).toHaveBeenCalledTimes(2)
    })
    expect(api.getCourse).toHaveBeenNthCalledWith(
      1,
      'CS',
      '225',
      'fall',
      2026,
      expect.any(AbortSignal)
    )
    expect(api.getCourse).toHaveBeenNthCalledWith(
      2,
      'CS',
      '225',
      'spring',
      2026,
      expect.any(AbortSignal)
    )
  })

  it('renders request failures without writing expected errors to the console', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    vi.mocked(api.getCourse).mockRejectedValueOnce(
      new Error('Course API unavailable')
    )

    renderCoursePage('/course/CS/225?term=fall&year=2026')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/That course did not load/i)
    expect(alert).toHaveTextContent(/Give it another moment/i)
    expect(alert).not.toHaveTextContent(/Course API unavailable/i)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('renders course scores, rating, GPA, and section stat fallbacks', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        primary_instructor: 'Lovelace, A',
        primary_instructor_rmp: 4.8,
        avg_gpa: 3.62,
        gpa_sample_size: 820,
        quality_score: 88,
        difficulty_score: 42,
        sections: [
          {
            crn: '12345',
            sectionNumber: 'AL1',
            status: 'Open',
            type: 'Lecture',
            days: 'MWF',
            startTime: '09:00',
            endTime: '09:50',
            location: 'Siebel Center',
            instructor: 'Lovelace, A',
            instructorRmp: null,
            instructorGpa: null,
            instructorStats: [
              {
                instructor_name: 'Lovelace, A',
                rmp_rating: 4.8,
                rmp_difficulty: 3.1,
                rmp_id: 'ada',
                avg_gpa: 3.62,
                median_gpa: null,
                gpa_sample_size: 820,
                num_ratings: 140,
                would_take_again_pct: null,
                top_tags: null,
                department: null,
              },
            ],
            sectionTitle: null,
            statusCode: null,
            sectionStatusCode: null,
            sectionText: null,
            sectionNotes: null,
            cappArea: null,
            dateRangeText: null,
            partOfTerm: null,
            startDate: null,
            endDate: null,
            creditHours: null,
            meetings: [
              {
                typeCode: 'LCD',
                typeName: 'Lecture-Discussion',
                days: 'MWF',
                startTime: '09:00',
                endTime: '09:50',
                buildingName: 'Siebel Center for Computer Science',
                roomNumber: '1404',
                dateRangeText: 'Jan 20, 2026 - May 6, 2026',
                instructorNames: ['Lovelace, A'],
                instructors: [],
              },
            ],
          },
        ],
      })
    )

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    const scorecard = (await screen.findByText('Course scores')).closest(
      '[data-slot="card"]'
    ) as HTMLElement
    expect(within(scorecard!).getByText('Excellent')).toBeInTheDocument()
    expect(within(scorecard!).queryByText('B+')).not.toBeInTheDocument()
    expect(within(scorecard!).getByText('Easy')).toBeInTheDocument()
    expect(within(scorecard!).getByText('4.8')).toBeInTheDocument()
    expect(within(scorecard!).getByText('3.62')).toBeInTheDocument()
    expect(within(scorecard!).getByText('820 records')).toBeInTheDocument()
    expect(
      within(scorecard!).getByText('Based on 820 records')
    ).toBeInTheDocument()
    expect(
      within(scorecard!).queryByText(/composite quality score/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Rating 4.8')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Avg GPA 3.62 from 820 records')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lovelace, A' })).toHaveAttribute(
      'href',
      'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A'
    )
    expect(screen.getByText(/4\.8 rating/)).toBeInTheDocument()
    expect(screen.getByText(/3\.62 avg GPA/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show details for CRN 12345' }))
    expect(screen.getByText('Meeting details')).toBeInTheDocument()
    expect(screen.getByText('Lecture-Discussion')).toBeInTheDocument()
    expect(screen.getByText('Siebel Center for Computer Science 1404')).toBeInTheDocument()
  })

  it('uses a course score sidebar at laptop widths, not only extra-wide screens', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        avg_gpa: 3.62,
        gpa_sample_size: 820,
        quality_score: 88,
        difficulty_score: 42,
      })
    )

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    const scorecard = (await screen.findByText('Course scores')).closest(
      '[data-slot="card"]'
    ) as HTMLElement
    const sidebar = scorecard.closest('aside')
    const layout = sidebar?.parentElement

    expect(sidebar).toHaveClass('md:sticky')
    expect(layout).toHaveClass('md:grid-cols-[17rem_minmax(0,1fr)]')
    expect(layout).toHaveClass('xl:grid-cols-[18rem_minmax(0,1fr)]')
    expect(layout).not.toHaveClass('xl:grid-cols-[21rem_minmax(0,1fr)]')
  })

  it('renders official Course Explorer links and public instructor link fallbacks', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        course_explorer_url:
          'https://courses.illinois.edu/schedule/2026/fall/CS/225',
        sections: [
          {
            crn: '45678',
            sectionNumber: 'AL1',
            status: 'Open',
            type: 'Lecture',
            days: 'MWF',
            startTime: '09:00',
            endTime: '09:50',
            location: 'Siebel Center',
            instructor: 'Fagen-Ulmschneider, W',
            instructorRmp: null,
            instructorGpa: null,
            course_explorer_url:
              'https://courses.illinois.edu/schedule/2026/fall/CS/225',
            instructorStats: [
              {
                instructor_name: 'Fagen-Ulmschneider, W',
                rmp_rating: 4.9,
                rmp_difficulty: 3.4,
                rmp_id: '85515',
                avg_gpa: 3.45,
                median_gpa: null,
                gpa_sample_size: 1200,
                num_ratings: 180,
                would_take_again_pct: null,
                top_tags: null,
                department: null,
              },
            ],
            sectionTitle: null,
            statusCode: null,
            sectionStatusCode: null,
            sectionText: null,
            sectionNotes: null,
            cappArea: null,
            dateRangeText: null,
            partOfTerm: null,
            startDate: null,
            endDate: null,
            creditHours: null,
            meetings: [],
          },
        ],
      })
    )

    renderCoursePage('/course/CS/225?term=fall&year=2026')

    expect(
      await screen.findByRole('link', { name: 'Course Explorer' })
    ).toHaveAttribute(
      'href',
      'https://courses.illinois.edu/schedule/2026/fall/CS/225'
    )
    expect(screen.getByRole('link', { name: 'CRN 45678' })).toHaveAttribute(
      'href',
      'https://courses.illinois.edu/schedule/2026/fall/CS/225'
    )
    expect(
      screen.getByRole('link', { name: 'Fagen-Ulmschneider, W' })
    ).toHaveAttribute(
      'href',
      'https://www.ratemyprofessors.com/professor/85515'
    )
  })
})
