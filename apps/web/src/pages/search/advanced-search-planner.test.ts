import { describe, expect, it } from 'vitest'
import { planAdvancedSearchApply } from './advanced-search-planner'

describe('planAdvancedSearchApply', () => {
  it('preserves free-text query terms when adding structured filters', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'algorithms',
        currentInputQuery: 'algorithms',
        inputDirty: false,
        interpretedAdvanced: { filters: {} },
        draft: { filters: { subject: 'CS' } },
        interpretedQuery: 'algorithms',
      })
    ).toEqual({
      kind: 'search',
      query: 'algorithms',
      filters: { filters: { subject: 'CS' } },
    })
  })

  it('uses typed text when the user edits the query before applying filters', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'intro to CS',
        currentInputQuery: 'philosophy ethics',
        inputDirty: true,
        interpretedAdvanced: { filters: { subject: 'CS' } },
        draft: { filters: { subject: 'PHIL' } },
        interpretedQuery: '',
      })
    ).toEqual({
      kind: 'search',
      query: 'philosophy ethics',
      filters: { filters: { subject: 'PHIL' } },
    })
  })

  it('drops parsed filter text when a structured filter replaces it', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'CS algorithms',
        currentInputQuery: 'CS algorithms',
        inputDirty: false,
        interpretedAdvanced: { filters: { subject: 'CS' } },
        draft: { filters: { subject: 'PHIL' } },
        interpretedQuery: 'algorithms',
      })
    ).toEqual({
      kind: 'search',
      query: 'algorithms',
      filters: { filters: { subject: 'PHIL' } },
      syncInputQuery: 'algorithms',
    })
  })

  it('uses the canonical interpreted query supplied by the server', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'intro to CS',
        currentInputQuery: 'intro to CS',
        inputDirty: false,
        interpretedAdvanced: { filters: { subject: 'CS' } },
        draft: { filters: { subject: 'PHIL' } },
        interpretedQuery: '',
      })
    ).toEqual({
      kind: 'search',
      query: '',
      filters: { filters: { subject: 'PHIL' } },
      syncInputQuery: '',
    })
  })

  it('clears when removing the last searchable request term and filter', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'CS',
        currentInputQuery: 'CS',
        inputDirty: false,
        interpretedAdvanced: { filters: { subject: 'CS' } },
        draft: { filters: {} },
        interpretedQuery: '',
      })
    ).toEqual({ kind: 'clear' })
  })
})
