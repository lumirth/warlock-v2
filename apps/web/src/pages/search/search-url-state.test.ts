import { describe, expect, it } from 'vitest'
import { readSearchUrlState, writeSearchUrlState } from './search-url-state'

describe('search URL state', () => {
  it('writes canonical share state without pagination offsets', () => {
    expect(
      writeSearchUrlState(
        {
          query: 'data structures',
          filters: { subject: 'CS', year: 2026, term: 'fall' },
          sort: { field: 'gpa', direction: 'desc' },
          pagination: { limit: 20, offset: 40 },
        },
        'table'
      )
    ).toBe(
      '?q=data+structures&subject=CS&term=fall&year=2026&sort=gpa&direction=desc&view=table'
    )
  })

  it('decodes malformed filters as recoverable URL errors', () => {
    const state = readSearchUrlState(new URLSearchParams('subject=C'))

    expect(state.request).toBeNull()
    expect(state.error).toMatch(/could not be restored/i)
  })
})
