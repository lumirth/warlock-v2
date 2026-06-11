import { describe, expect, it } from 'vitest'
import { singleRequirementFilter } from '@uiuc-course-search/query-types'
import {
  planSearchRequest,
} from './search-refinement-actions'

describe('search refinement actions', () => {
  it('turns public ambiguity actions into canonical filter-only refinement requests', () => {
    const plan = planSearchRequest({
      query: '',
      filters: { requirement: singleRequirementFilter('CS') },
      sort: { field: 'relevance', direction: 'desc' },
      scope: 'active',
    })

    expect(plan).toEqual({
      kind: 'search',
      draft: { filters: { requirement: singleRequirementFilter('CS') } },
      request: {
        query: '',
        filters: { requirement: singleRequirementFilter('CS') },
        sort: { field: 'relevance', direction: 'desc' },
        scope: 'active',
      },
    })
  })

  it('removes chips by running their canonical next request', () => {
    const plan = planSearchRequest({
      query: 'CS',
      sort: { field: 'relevance', direction: 'desc' },
      scope: 'active',
    })

    expect(plan).toEqual({
      kind: 'search',
      draft: { filters: {} },
      request: {
        query: 'CS',
        sort: { field: 'relevance', direction: 'desc' },
        scope: 'active',
      },
    })
  })
})
