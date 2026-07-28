import { describe, expect, it } from 'vitest'
import {
  INITIAL_SEARCH_CONTROLLER_STATE,
  type SearchControllerState,
} from './search-controller-state'
import { buildSearchViewModel } from './search-view-model'
import type { SearchCourseResultDto } from '@uiuc-course-search/query-types'

type StateOverrides = {
  draft?: Partial<SearchControllerState['draft']>
  session?: Partial<SearchControllerState['session']>
}

function state(overrides: StateOverrides = {}): SearchControllerState {
  return {
    ...INITIAL_SEARCH_CONTROLLER_STATE,
    draft: {
      ...INITIAL_SEARCH_CONTROLLER_STATE.draft,
      ...overrides.draft,
    },
    session: {
      ...INITIAL_SEARCH_CONTROLLER_STATE.session,
      ...overrides.session,
    },
  }
}

function result(id: string): SearchCourseResultDto {
  const [subject, number] = id.split('-')
  return {
    course: {
      id,
      subject,
      number,
      title: `${subject} ${number}`,
      description: null,
      creditHours: null,
      creditHoursText: null,
      year: 2026,
      term: 'spring',
      primaryInstructor: null,
      metrics: {
        primaryInstructorRating: null,
        avgGpa: null,
        medianGpa: null,
        gpaSampleSize: null,
        qualityScore: null,
        instructorDifficultyScore: null,
      },
      catalog: {
        courseInfo: null,
        degreeAttributes: null,
      },
      scheduleNotes: {
        classScheduleInfo: null,
        dateRangeText: null,
      },
      registration: {
        registrationNotes: null,
        approvalCode: null,
      },
      requirements: [],
      links: {},
    },
  }
}

describe('buildSearchViewModel', () => {
  it('shows the first-run helper only before any active request exists', () => {
    const model = buildSearchViewModel(state({ draft: { query: '' } }))

    expect(model.showFirstRunExamples).toBe(true)
    expect(model.hasActiveRequest).toBe(false)
    expect(model.activeRequestQuery).toBe('')
  })

  it('derives active request labels from the canonical response state', () => {
    const model = buildSearchViewModel(
      state({
        session: {
          activeRequest: {
            query: 'online stats class',
          },
          results: [result('STAT-100')],
          meta: {
            nextRequest: { query: 'online stats class' },
            interpretedRequest: { query: 'online stats class' },
            ui: { chips: [], ambiguityActions: [] },
          },
          pagination: {
            totalResults: 41,
            browseableResults: 41,
            limit: 20,
            offset: 0,
            hasMore: true,
            nextOffset: 20,
          },
        },
      })
    )

    expect(model.activeRequestQuery).toBe('online stats class')
    expect(model.resultCountLabel).toBe('41 results')
    expect(model.showingResultsLabel).toBe('Showing 1 of 41')
    expect(model.resultsHeadingLabel).toBe('Results for online stats class')
  })

  it('distinguishes the exact match total from the ranked browse window', () => {
    const model = buildSearchViewModel(
      state({
        session: {
          results: [result('HIST-1')],
          pagination: {
            totalResults: 4509,
            browseableResults: 1,
            limit: 1,
            offset: 0,
            hasMore: false,
            nextOffset: null,
          },
        },
      })
    )

    expect(model.resultCountLabel).toBe('4,509 results')
    expect(model.showingResultsLabel).toBe('Showing top 1 of 4,509')
  })

  it('labels a degraded result count as a lower bound', () => {
    const model = buildSearchViewModel(
      state({
        session: {
          results: [result('STAT-100')],
          meta: {
            nextRequest: { query: 'statistics' },
            interpretedRequest: { query: 'statistics' },
            ui: { chips: [], ambiguityActions: [] },
            retrieval: { degraded: true },
          },
          pagination: {
            totalResults: 41,
            countIsComplete: false,
            browseableResults: 20,
            limit: 20,
            offset: 0,
            hasMore: true,
            nextOffset: 20,
          },
        },
      })
    )

    expect(model.resultCountLabel).toBe('At least 41 results')
    expect(model.showingResultsLabel).toBe('Showing 1 of at least 41')
  })

  it('distinguishes initial skeletons from result refreshes', () => {
    expect(
      buildSearchViewModel(state({ session: { loading: true } }))
        .showInitialSkeleton
    ).toBe(true)

    const refreshing = buildSearchViewModel(
      state({
        session: {
          loading: true,
          meta: {
            nextRequest: { query: 'cs' },
            interpretedRequest: { query: 'cs' },
            ui: { chips: [], ambiguityActions: [] },
          },
        },
      })
    )

    expect(refreshing.isRefreshingResults).toBe(true)
    expect(refreshing.showInitialSkeleton).toBe(false)
  })
})
