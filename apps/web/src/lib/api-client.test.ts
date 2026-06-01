import { describe, expect, it, vi, afterEach } from 'vitest'
import { ApiClient } from './api-client'
import type { CourseDto } from '@uiuc-course-search/query-types'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApiClient', () => {
  it('returns the shared course DTO without client-side shape normalization', async () => {
    const course: CourseDto = {
      id: 'CS-225-2026-spring',
      subject: 'CS',
      number: '225',
      title: 'Data Structures',
      description: null,
      credit_hours: 4,
      gened: null,
      year: 2026,
      term: 'spring',
      primary_instructor: null,
      quality_score: null,
      difficulty_score: null,
      instructor_links: {},
      sections: [{
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
      }],
    }

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => course,
    } as Response)

    const client = new ApiClient('https://api.example.test/')
    await expect(client.getCourse('CS', '225', 'spring', 2026)).resolves.toEqual(course)
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
    await expect(client.search('cs')).rejects.toThrow('Invalid limit')
  })
})
