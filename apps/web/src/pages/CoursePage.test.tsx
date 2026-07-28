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
  CourseInstructorDto,
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

type SectionOverride = Partial<
  Omit<
    CourseSectionDto,
    'availability' | 'schedule' | 'instructors' | 'sourceFacts' | 'links'
  >
> & {
  availability?: Partial<CourseSectionDto['availability']>
  schedule?: Partial<CourseSectionDto['schedule']>
  instructors?: CourseSectionDto['instructors']
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
    instructors: overrides.instructors ?? [],
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
    description:
      overrides.description === undefined ? 'A course' : overrides.description,
    creditHours:
      overrides.creditHours === undefined ? 4 : overrides.creditHours,
    creditHoursText:
      overrides.creditHoursText === undefined
        ? overrides.creditHours === null
          ? null
          : '4 hours.'
        : overrides.creditHoursText,
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
      instructorDifficultyScore:
        overrides.metrics?.instructorDifficultyScore ?? null,
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
    links: overrides.links ?? {},
    sections: overrides.sections ?? [],
  }

  return {
    course: courseDetail,
  }
}

function instructor(
  name: string,
  overrides: Partial<Omit<CourseInstructorDto, 'name'>> = {}
): CourseInstructorDto {
  return {
    name,
    rmpRating: overrides.rmpRating ?? null,
    rmpDifficulty: overrides.rmpDifficulty ?? null,
    rmpId: overrides.rmpId ?? null,
    rmpUrl: overrides.rmpUrl ?? null,
    rmpSearchUrl: overrides.rmpSearchUrl ?? null,
    avgGpa: overrides.avgGpa ?? null,
    medianGpa: overrides.medianGpa ?? null,
    gpaSampleSize: overrides.gpaSampleSize ?? null,
    numRatings: overrides.numRatings ?? null,
    wouldTakeAgainPct: overrides.wouldTakeAgainPct ?? null,
    topTags: overrides.topTags ?? null,
    department: overrides.department ?? null,
  }
}

function renderCoursePage(
  initialEntry: string | { pathname: string; search?: string; state?: unknown }
) {
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
  it('preserves the exact search URL for the return action', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(course())

    renderCoursePage({
      pathname: '/course/CS/225',
      search: '?term=spring&year=2026',
      state: {
        fromSearch: true,
        returnTo: '/?q=data+structures&subject=CS&view=table',
      },
    })

    expect(
      await screen.findByRole('link', { name: /back to search results/i })
    ).toHaveAttribute('href', '/?q=data+structures&subject=CS&view=table')
    expect(document.title).toBe('CS 225: Data Structures · UIUC Course Search')
  })

  it('makes stale cached detail unmistakable', async () => {
    const response = course()
    response.cache = {
      cached: true,
      stale: true,
      staleReason: 'upstream unavailable',
      fetchedAt: 1780358400,
      termStatus: 'registrable',
    }
    vi.mocked(api.getCourse).mockResolvedValueOnce(response)

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/saved course data may be out of date/i)
    expect(alert).toHaveTextContent(/verify section status/i)
  })

  it('renders honest fallbacks for nullable catalog fields', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({ description: null, creditHours: null })
    )

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    expect(
      await screen.findByText(/credit hours not listed/i)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no catalog description is available/i)
    ).toBeInTheDocument()
  })

  it('shows official variable-credit wording without inventing an exact value', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        creditHours: null,
        creditHoursText: '1 to 4 hours.',
      })
    )

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    expect(await screen.findByText('1 to 4 hours.')).toBeInTheDocument()
    expect(screen.queryByText('1 credit hour')).not.toBeInTheDocument()
  })

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

  it('retries a failed course request without reloading the page', async () => {
    vi.mocked(api.getCourse)
      .mockRejectedValueOnce(new Error('Course API unavailable'))
      .mockResolvedValueOnce(course())

    renderCoursePage('/course/CS/225?term=fall&year=2026')

    fireEvent.click(
      await screen.findByRole('button', {
        name: /try loading this course again/i,
      })
    )

    expect(
      await screen.findByRole('heading', {
        name: 'CS 225: Data Structures',
      })
    ).toBeInTheDocument()
    expect(api.getCourse).toHaveBeenCalledTimes(2)
  })

  it('renders course scores, rating, GPA, and canonical section instructors', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        primaryInstructor: 'Lovelace, A',
        metrics: {
          primaryInstructorRating: 4.8,
          avgGpa: 3.62,
          gpaSampleSize: 820,
          qualityScore: 88,
          instructorDifficultyScore: 42,
        },
        sections: [
          section({
            instructors: [
              instructor('Lovelace, A', {
                rmpRating: 4.8,
                rmpDifficulty: 3.1,
                rmpId: 'ada',
                rmpSearchUrl:
                  'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A',
                avgGpa: 3.62,
                gpaSampleSize: 820,
                numRatings: 140,
              }),
            ],
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
                  instructors: [
                    instructor('Lovelace, A', {
                      rmpRating: 4.8,
                      rmpDifficulty: 3.1,
                      rmpId: 'ada',
                      rmpSearchUrl:
                        'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A',
                      avgGpa: 3.62,
                      gpaSampleSize: 820,
                      numRatings: 140,
                    }),
                  ],
                },
              ],
            },
          }),
        ],
      })
    )

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    const scorecard = (
      await screen.findByText('Evidence-limited signals')
    ).closest('[data-slot="card"]') as HTMLElement
    expect(within(scorecard!).getByText('Excellent')).toBeInTheDocument()
    expect(within(scorecard!).queryByText('B+')).not.toBeInTheDocument()
    expect(within(scorecard!).getByText('Lower')).toBeInTheDocument()
    expect(within(scorecard!).getByText('4.8 / 5')).toBeInTheDocument()
    expect(within(scorecard!).getByText('3.62')).toBeInTheDocument()
    expect(within(scorecard!).getByText('820 GPA records')).toBeInTheDocument()
    expect(
      within(scorecard!).getByText(/at least 30 GPA records and 5 RMP ratings/i)
    ).toBeInTheDocument()
    expect(
      within(scorecard!).getByText(
        'Instructor difficulty comes from linked RMP data; it does not measure assigned work.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Rating 4.8')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Avg GPA 3.62 from 820 records')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lovelace, A' })).toHaveAttribute(
      'href',
      'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A'
    )
    expect(
      screen.getByText(/RMP 4\.8 \/ 5 \(140 ratings\)/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/3\.62 avg GPA \(820 records\)/)
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Course sections')).toHaveClass(
      'overflow-x-auto'
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Show details for CRN 12345' })
    )
    expect(screen.getByText('Meeting details')).toBeInTheDocument()
    expect(screen.getByText('Lecture-Discussion')).toBeInTheDocument()
    expect(
      screen.getByText('Siebel Center for Computer Science 1404')
    ).toBeInTheDocument()
  })

  it('places registration content before a secondary signal sidebar', async () => {
    vi.mocked(api.getCourse).mockResolvedValueOnce(
      course({
        metrics: {
          avgGpa: 3.62,
          gpaSampleSize: 820,
          qualityScore: 88,
          instructorDifficultyScore: 42,
        },
      })
    )

    renderCoursePage('/course/CS/225?term=spring&year=2026')

    const scorecard = (
      await screen.findByText('Evidence-limited signals')
    ).closest('[data-slot="card"]') as HTMLElement
    const sidebar = scorecard.closest('aside')
    const layout = sidebar?.parentElement
    const sectionsHeading = screen.getByRole('heading', {
      name: /sections and instructors/i,
    })

    expect(sidebar).toHaveClass('lg:sticky')
    expect(layout).toHaveClass('lg:grid-cols-[minmax(0,1fr)_18rem]')
    expect(
      sectionsHeading.compareDocumentPosition(scorecard) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('renders official Course Explorer and instructor links', async () => {
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
            instructors: [
              instructor('Fagen-Ulmschneider, W', {
                rmpRating: 4.9,
                rmpDifficulty: 3.4,
                rmpId: '85515',
                rmpUrl: 'https://www.ratemyprofessors.com/professor/85515',
                avgGpa: 3.45,
                gpaSampleSize: 1200,
                numRatings: 180,
              }),
            ],
          }),
        ],
      })
    )

    renderCoursePage('/course/CS/225?term=fall&year=2026')

    expect(
      await screen.findByRole('link', {
        name: 'View official course listing',
      })
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
