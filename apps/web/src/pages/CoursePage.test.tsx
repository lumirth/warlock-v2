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
import type {
  CourseDetailDto,
  CourseDetailResponseDto,
  CourseSectionDto,
} from '@uiuc-course-search/query-types'
import { api } from '../lib/api-client'
import { TestUiProvider } from '../test/TestUiProvider'
import { CoursePage } from './CoursePage'

vi.mock('../lib/api-client', () => ({
  api: {
    getCourse: vi.fn(),
  },
}))

type CourseOverride = Omit<
  Partial<CourseDetailDto>,
  'metrics' | 'catalog' | 'scheduleNotes' | 'registration' | 'sections'
> & {
  metrics?: Partial<CourseDetailDto['metrics']>
  catalog?: Partial<CourseDetailDto['catalog']>
  scheduleNotes?: Partial<CourseDetailDto['scheduleNotes']>
  registration?: Partial<CourseDetailDto['registration']>
  sections?: CourseSectionDto[]
}

type SectionOverride = Partial<Omit<CourseSectionDto, 'availability' | 'schedule' | 'instructors' | 'sourceFacts' | 'links'>> & {
  availability?: Partial<CourseSectionDto['availability']>
  schedule?: Partial<CourseSectionDto['schedule']>
  instructors?: Partial<CourseSectionDto['instructors']>
  sourceFacts?: Partial<CourseSectionDto['sourceFacts']>
  links?: Partial<CourseSectionDto['links']>
}

function section(overrides: SectionOverride = {}): CourseSectionDto {
  return {
    crn: overrides.crn ?? '12345',
    sectionNumber: overrides.sectionNumber ?? 'AL1',
    availability: {
      status: overrides.availability?.status ?? 'open',
      label: overrides.availability?.label ?? 'Open',
      rawStatus: overrides.availability?.rawStatus ?? 'Open',
      statusCode: overrides.availability?.statusCode ?? null,
      sectionStatusCode: overrides.availability?.sectionStatusCode ?? null,
    },
    schedule: {
      type: overrides.schedule?.type ?? 'Lecture',
      days: overrides.schedule?.days ?? 'MWF',
      startTime: overrides.schedule?.startTime ?? '09:00',
      endTime: overrides.schedule?.endTime ?? '09:50',
      location: overrides.schedule?.location ?? 'Siebel Center',
      dateRangeText: overrides.schedule?.dateRangeText ?? null,
      partOfTerm: overrides.schedule?.partOfTerm ?? null,
      startDate: overrides.schedule?.startDate ?? null,
      endDate: overrides.schedule?.endDate ?? null,
      creditHours: overrides.schedule?.creditHours ?? null,
      meetings: overrides.schedule?.meetings ?? [],
    },
    instructors: {
      displayName: overrides.instructors?.displayName ?? 'TBA',
      rmpRating: overrides.instructors?.rmpRating ?? null,
      avgGpa: overrides.instructors?.avgGpa ?? null,
      stats: overrides.instructors?.stats ?? [],
    },
    sourceFacts: {
      sectionTitle: overrides.sourceFacts?.sectionTitle ?? null,
      sectionText: overrides.sourceFacts?.sectionText ?? null,
      sectionNotes: overrides.sourceFacts?.sectionNotes ?? null,
      cappArea: overrides.sourceFacts?.cappArea ?? null,
    },
    links: {
      courseExplorerUrl: overrides.links?.courseExplorerUrl,
    },
  }
}

function course(overrides: CourseOverride = {}): CourseDetailResponseDto {
  const courseDetail: CourseDetailDto = {
    id: overrides.id ?? 'CS-225-2026-spring',
    subject: overrides.subject ?? 'CS',
    number: overrides.number ?? '225',
    title: overrides.title ?? 'Data Structures',
    description: overrides.description ?? 'A course',
    creditHours: overrides.creditHours ?? 4,
    year: overrides.year ?? 2026,
    term: overrides.term ?? 'spring',
    primaryInstructor: overrides.primaryInstructor ?? null,
    metrics: {
      primaryInstructorRating:
        overrides.metrics?.primaryInstructorRating ?? null,
      avgGpa: overrides.metrics?.avgGpa ?? null,
      medianGpa: overrides.metrics?.medianGpa ?? null,
      gpaSampleSize: overrides.metrics?.gpaSampleSize ?? null,
      qualityScore: overrides.metrics?.qualityScore ?? null,
      workloadScore: overrides.metrics?.workloadScore ?? null,
    },
    catalog: {
      courseInfo: overrides.catalog?.courseInfo ?? null,
      degreeAttributes: overrides.catalog?.degreeAttributes ?? null,
    },
    scheduleNotes: {
      classScheduleInfo: overrides.scheduleNotes?.classScheduleInfo ?? null,
      dateRangeText: overrides.scheduleNotes?.dateRangeText ?? null,
    },
    registration: {
      registrationNotes: overrides.registration?.registrationNotes ?? null,
      approvalCode: overrides.registration?.approvalCode ?? null,
    },
    requirements: overrides.requirements ?? [],
    instructorLinks: overrides.instructorLinks ?? {},
    links: overrides.links ?? {},
    sections: overrides.sections ?? [],
  }

  return {
    course: courseDetail,
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
        primaryInstructor: 'Lovelace, A',
        metrics: {
          primaryInstructorRating: 4.8,
          avgGpa: 3.62,
          gpaSampleSize: 820,
          qualityScore: 88,
          workloadScore: 42,
        },
        sections: [
          section({
            instructors: {
              displayName: 'Lovelace, A',
              stats: [
              {
                instructorName: 'Lovelace, A',
                rmpRating: 4.8,
                rmpDifficulty: 3.1,
                rmpId: 'ada',
                avgGpa: 3.62,
                medianGpa: null,
                gpaSampleSize: 820,
                numRatings: 140,
                wouldTakeAgainPct: null,
                topTags: null,
                department: null,
              },
            ],
            },
            schedule: {
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
          }),
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
    expect(
      screen.getByLabelText('Sections table with horizontal scrolling')
    ).toHaveClass('overflow-x-auto')

    fireEvent.click(screen.getByRole('button', { name: 'Show details for CRN 12345' }))
    expect(screen.getByText('Meeting details')).toBeInTheDocument()
    expect(screen.getByText('Lecture-Discussion')).toBeInTheDocument()
    expect(screen.getByText('Siebel Center for Computer Science 1404')).toBeInTheDocument()
  })

  it('uses a course score sidebar at laptop widths, not only extra-wide screens', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        metrics: {
          avgGpa: 3.62,
          gpaSampleSize: 820,
          qualityScore: 88,
          workloadScore: 42,
        },
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
        links: {
          courseExplorerUrl:
            'https://courses.illinois.edu/schedule/2026/fall/CS/225',
        },
        sections: [
          section({
            crn: '45678',
            links: {
              courseExplorerUrl:
                'https://courses.illinois.edu/schedule/2026/fall/CS/225',
            },
            instructors: {
              displayName: 'Fagen-Ulmschneider, W',
              stats: [
              {
                instructorName: 'Fagen-Ulmschneider, W',
                rmpRating: 4.9,
                rmpDifficulty: 3.4,
                rmpId: '85515',
                avgGpa: 3.45,
                medianGpa: null,
                gpaSampleSize: 1200,
                numRatings: 180,
                wouldTakeAgainPct: null,
                topTags: null,
                department: null,
              },
            ],
            },
          }),
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
