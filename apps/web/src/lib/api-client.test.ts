import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiClient } from './api-client'
import {
  singleRequirementFilter,
  type CourseDetailResponseDto,
} from '@uiuc-course-search/query-types'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApiClient', () => {
  it('returns the shared course DTO without client-side shape normalization', async () => {
    const course: CourseDetailResponseDto = {
      course: {
        id: 'CS-225-2026-spring',
        subject: 'CS',
        number: '225',
        title: 'Data Structures',
        description: null,
        creditHours: 4,
        year: 2026,
        term: 'spring',
        primaryInstructor: null,
        metrics: {
          primaryInstructorRating: null,
          avgGpa: null,
          medianGpa: null,
          gpaSampleSize: null,
          qualityScore: null,
          workloadScore: null,
        },
        registration: {
          courseInfo: null,
          degreeAttributes: null,
          classScheduleInfo: null,
          dateRangeText: null,
          registrationNotes: null,
          approvalCode: null,
        },
        requirements: [],
        instructorLinks: {},
        links: {},
        sections: [
          {
            crn: '12345',
            sectionNumber: 'AL1',
            status: 'Open',
            type: 'Lecture',
            days: 'MWF',
            startTime: '09:00',
            endTime: '09:50',
            location: 'Siebel 1404',
            instructor: 'TBA',
            instructorRmp: null,
            instructorGpa: null,
            instructorStats: [],
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
      },
    }

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => course,
    } as Response)

    const client = new ApiClient('https://api.example.test/')
    await expect(
      client.getCourse('CS', '225', 'spring', 2026)
    ).resolves.toEqual(course)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/course/CS/225?term=spring&year=2026',
      { signal: undefined }
    )
  })

  it('uses API error bodies when a request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Invalid limit' }),
    } as Response)

    const client = new ApiClient('https://api.example.test')
    await expect(client.search({ query: 'cs' })).rejects.toThrow(
      'Invalid limit'
    )
  })

  it('sends search pagination parameters when provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        meta: {
          query: { raw: 'intro to CS', residual: '' },
          timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
        },
        pagination: {
          resultCountLowerBound: 21,
          limit: 20,
          offset: 20,
          hasMore: true,
          nextOffset: 40,
        },
      }),
    } as Response)

    const controller = new AbortController()
    const client = new ApiClient('https://api.example.test')
    await client.search(
      {
        query: 'intro to CS',
        pagination: { limit: 20, offset: 20 },
      },
      { signal: controller.signal }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/search?q=intro+to+CS&limit=20&offset=20',
      { signal: controller.signal }
    )
  })

  it('sends structured advanced search filters as query parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        meta: {
          query: { raw: 'algorithms', residual: 'algorithms' },
          timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
        },
        pagination: {
          resultCountLowerBound: 0,
          limit: 20,
          offset: 0,
        },
      }),
    } as Response)

    const client = new ApiClient('https://api.example.test')
    await client.search({
      query: 'algorithms',
      pagination: { limit: 20, offset: 0 },
      filters: {
        subject: 'CS',
        number: '225',
        instructor: 'Fagen',
        term: 'spring',
        year: 2026,
        requirement: singleRequirementFilter('HUM'),
        credits: 4,
        days: 'MWF',
        time: 'morning',
        online: true,
        status: 'open',
        workload: 'easy',
        level: 400,
      },
      scope: 'all',
      sort: { field: 'gpa', direction: 'desc' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/search?q=algorithms&limit=20&offset=0&subject=CS&number=225&instructor=Fagen&term=spring&year=2026&requirement=HUM&credits=4&days=MWF&time=morning&online=true&status=open&workload=easy&level=400&scope=all&sort=gpa&direction=desc',
      { signal: undefined }
    )
  })

  it('submits typed feedback to the public feedback endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'feedback-1',
        status: 'accepted',
        received_at: 1780358400,
      }),
    } as Response)

    const client = new ApiClient('https://api.example.test')
    await expect(
      client.submitFeedback({
        kind: 'search_results',
        issue: 'expected_different_results',
        page: 'search',
        query: 'professor fagen',
        expected: 'classes with Wade Fagen-Ulmschneider',
      })
    ).resolves.toEqual({
      id: 'feedback-1',
      status: 'accepted',
      received_at: 1780358400,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/feedback',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'search_results',
          issue: 'expected_different_results',
          page: 'search',
          query: 'professor fagen',
          expected: 'classes with Wade Fagen-Ulmschneider',
        }),
        signal: undefined,
      }
    )
  })
})
