import { describe, expect, it } from 'vitest'
import {
  INITIAL_SEARCH_CONTROLLER_STATE,
  searchControllerReducer,
  type SearchControllerState,
} from './search-controller-state'

describe('searchControllerReducer', () => {
  it('clears the query draft when no executable search intent remains', () => {
    const state = {
      ...INITIAL_SEARCH_CONTROLLER_STATE,
      draft: {
        ...INITIAL_SEARCH_CONTROLLER_STATE.draft,
        query: 'humanities',
        inputDirty: true,
      },
      session: {
        ...INITIAL_SEARCH_CONTROLLER_STATE.session,
        activeRequest: { query: 'humanities' },
      },
    }

    const cleared = searchControllerReducer(state, { type: 'search/cleared' })

    expect(cleared.draft.query).toBe('')
    expect(cleared.draft.inputDirty).toBe(false)
    expect(cleared.session.activeRequest).toBeNull()
  })

  it('preserves an existing result session when a continuation request fails', () => {
    const state: SearchControllerState = {
      ...INITIAL_SEARCH_CONTROLLER_STATE,
      session: {
        ...INITIAL_SEARCH_CONTROLLER_STATE.session,
        results: [
          { course: { id: 'CS-225' } },
        ] as SearchControllerState['session']['results'],
        meta: {
          nextRequest: { query: 'data structures' },
          interpretedRequest: { query: 'data structures' },
          ui: { chips: [], ambiguityActions: [] },
        },
        pagination: {
          totalResults: 40,
          browseableResults: 40,
          limit: 20,
          offset: 0,
          hasMore: true,
          nextOffset: 20,
        },
      },
    }

    const failed = searchControllerReducer(state, {
      type: 'search/failed',
      message: 'Try again.',
      mode: 'append',
    })

    expect(failed.session.results).toBe(state.session.results)
    expect(failed.session.meta).toBe(state.session.meta)
    expect(failed.session.pagination).toBe(state.session.pagination)
    expect(failed.session.error).toBe('Try again.')
  })

  it('rolls an optimistic sort label back when refresh fails', () => {
    const state: SearchControllerState = {
      ...INITIAL_SEARCH_CONTROLLER_STATE,
      session: {
        ...INITIAL_SEARCH_CONTROLLER_STATE.session,
        sort: { field: 'gpa', direction: 'desc' },
        committedSort: { field: 'relevance', direction: 'desc' },
        results: [
          { course: { id: 'CS-225' } },
        ] as SearchControllerState['session']['results'],
      },
    }

    const failed = searchControllerReducer(state, {
      type: 'search/failed',
      message: 'Try again.',
      mode: 'refresh',
    })

    expect(failed.session.sort).toEqual({
      field: 'relevance',
      direction: 'desc',
    })
    expect(failed.session.results).toBe(state.session.results)
  })
})
