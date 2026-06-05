import { describe, expect, it } from 'vitest'
import {
  planAmbiguityAction,
  planChipRemoval,
  planRecoveryAction,
  type RefinementContext,
} from './search-refinement-actions'

const baseContext: RefinementContext = {
  activeRequestQuery: 'CS',
  typedQuery: 'CS',
  metaRawQuery: 'CS',
  residualQuery: '',
  activeFilters: { subject: 'CS' },
  sort: { field: 'relevance', direction: 'desc' },
}

describe('search refinement actions', () => {
  it('turns public ambiguity actions into canonical filter-only refinement requests', () => {
    const plan = planAmbiguityAction(
      {
        id: '0-0-requirement-CS',
        term: 'CS',
        label: 'Cultural Studies',
        action: {
          kind: 'run_search',
          nextRequest: {
            query: '',
            filters: { requirement: 'CS' },
            sort: { field: 'relevance', direction: 'desc' },
            scope: 'active',
          },
        },
      },
      baseContext
    )

    expect(plan).toEqual({
      kind: 'search',
      draft: { requirement: 'CS' },
      request: {
        query: '',
        filters: { requirement: 'CS' },
        sort: { field: 'relevance', direction: 'desc' },
      },
    })
  })

  it('removes chips by running their canonical next request', () => {
    const plan = planChipRemoval(
      {
        id: 'subject-0',
        type: 'subject',
        label: 'Subject CS',
        value: 'CS',
        source: 'natural_language',
        removable: true,
        editable: true,
        action: {
          kind: 'run_search',
          nextRequest: {
            query: 'CS',
            sort: { field: 'relevance', direction: 'desc' },
            scope: 'active',
          },
        },
      },
      baseContext
    )

    expect(plan).toEqual({
      kind: 'search',
      draft: {},
      request: {
        query: 'CS',
        filters: {},
        sort: { field: 'relevance', direction: 'desc' },
      },
    })
  })

  it('uses recovery group canonical requests and preserves the requested sort', () => {
    const plan = planRecoveryAction(
      {
        id: 'any-delivery',
        label: 'Show any delivery mode',
        description: 'Relax online delivery.',
        relaxes: ['online'],
        keeps: ['topic'],
        action: {
          kind: 'run_search',
          nextRequest: {
            query: 'movies class',
            filters: { online: true },
            sort: { field: 'gpa', direction: 'desc' },
            scope: 'active',
          },
        },
      },
      {
        ...baseContext,
        activeRequestQuery: 'movies online',
        activeFilters: { online: true },
        sort: { field: 'gpa', direction: 'desc' },
      }
    )

    expect(plan).toEqual({
      kind: 'search',
      draft: { online: true },
      request: {
        query: 'movies class',
        filters: { online: true },
        sort: { field: 'gpa', direction: 'desc' },
      },
    })
  })
})
