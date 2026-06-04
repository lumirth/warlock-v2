import { describe, expect, it } from 'vitest'
import { planAdvancedSearchApply } from './advanced-search-planner'

describe('planAdvancedSearchApply', () => {
  it('preserves free-text query terms when adding structured filters', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'algorithms',
        currentInputQuery: 'algorithms',
        inputDirty: false,
        interpretedAdvanced: {},
        draft: { subject: 'CS' },
        residualQuery: 'algorithms',
      })
    ).toEqual({
      kind: 'search',
      query: 'algorithms',
      filters: { subject: 'CS' },
    })
  })

  it('uses typed text when the user edits the query before applying filters', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'intro to CS',
        currentInputQuery: 'philosophy ethics',
        inputDirty: true,
        interpretedAdvanced: { subject: 'CS' },
        draft: { subject: 'PHIL' },
        residualQuery: 'intro to',
      })
    ).toEqual({
      kind: 'search',
      query: 'philosophy ethics',
      filters: { subject: 'PHIL' },
    })
  })

  it('drops parsed filter text when a structured filter replaces it', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'CS algorithms',
        currentInputQuery: 'CS algorithms',
        inputDirty: false,
        interpretedAdvanced: { subject: 'CS' },
        draft: { subject: 'PHIL' },
        residualQuery: 'algorithms',
      })
    ).toEqual({
      kind: 'search',
      query: 'algorithms',
      filters: { subject: 'PHIL' },
      syncInputQuery: 'algorithms',
    })
  })

  it('does not preserve weak residual scaffolding as a new query', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'intro to CS',
        currentInputQuery: 'intro to CS',
        inputDirty: false,
        interpretedAdvanced: { subject: 'CS' },
        draft: { subject: 'PHIL' },
        residualQuery: 'intro to',
      })
    ).toEqual({
      kind: 'search',
      query: '',
      filters: { subject: 'PHIL' },
      syncInputQuery: '',
    })
  })

  it('clears when removing the last searchable request term and filter', () => {
    expect(
      planAdvancedSearchApply({
        activeRequestQuery: 'CS',
        currentInputQuery: 'CS',
        inputDirty: false,
        interpretedAdvanced: { subject: 'CS' },
        draft: {},
        residualQuery: '',
      })
    ).toEqual({ kind: 'clear' })
  })
})
