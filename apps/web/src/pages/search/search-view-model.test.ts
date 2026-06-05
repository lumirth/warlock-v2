import { describe, expect, it } from 'vitest'
import {
  INITIAL_SEARCH_CONTROLLER_STATE,
  type SearchControllerState,
} from './search-controller-state'
import { buildSearchViewModel } from './search-view-model'

type StateOverrides = {
  draft?: Partial<SearchControllerState['draft']>
  session?: Partial<SearchControllerState['session']>
}

function state(
  overrides: StateOverrides = {}
): SearchControllerState {
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
          results: [
            { id: 'STAT-100' } as unknown as SearchControllerState['session']['results'][number],
          ],
          meta: {
            query: { raw: 'online stats class', residual: 'stats' },
            nextRequest: { query: 'online stats class' },
            timing: { extraction_ms: 1, search_ms: 2, total_ms: 3 },
          },
          pagination: {
            totalResults: 41,
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

  it('distinguishes initial skeletons from result refreshes', () => {
    expect(
      buildSearchViewModel(state({ session: { loading: true } })).showInitialSkeleton
    ).toBe(true)

    const refreshing = buildSearchViewModel(
      state({
        session: {
          loading: true,
          meta: {
            query: { raw: 'cs', residual: 'cs' },
            nextRequest: { query: 'cs' },
            timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
          },
        },
      })
    )

    expect(refreshing.isRefreshingResults).toBe(true)
    expect(refreshing.showInitialSkeleton).toBe(false)
  })
})
