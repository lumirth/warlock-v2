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
  visibleAdvanced: { subject: 'CS' },
  sort: { field: 'relevance', direction: 'desc' },
}

describe('search refinement actions', () => {
  it('turns public ambiguity actions into canonical filter-only refinement requests', () => {
    const plan = planAmbiguityAction(
      {
        id: '0-0-gened-CS',
        term: 'CS',
        label: 'Cultural Studies',
        filter: { gened: 'CS' },
        queryPatch: { replaceQuery: 'gened:CS' },
      },
      baseContext
    )

    expect(plan).toEqual({
      kind: 'search',
      draft: { gened: 'CS' },
      request: {
        query: '',
        filters: { gened: 'CS' },
      },
    })
  })

  it('removes chips using public filter patches before falling back to query patches', () => {
    const plan = planChipRemoval(
      {
        id: 'subject-0',
        type: 'subject',
        label: 'Subject CS',
        value: 'CS',
        source: 'natural_language',
        removable: true,
        editable: true,
        filter: { subject: 'CS' },
        queryPatch: { removeText: 'CS' },
      },
      baseContext
    )

    expect(plan).toEqual({
      kind: 'search',
      draft: {},
      request: {
        query: 'CS',
        filters: {},
      },
    })
  })

  it('uses recovery group query patches and preserves the active sort', () => {
    const plan = planRecoveryAction(
      {
        id: 'any-delivery',
        label: 'Show any delivery mode',
        description: 'Relax online delivery.',
        relaxes: ['online'],
        keeps: ['topic'],
        queryPatch: { replaceQuery: 'movies class' },
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
      request: {
        query: 'movies class',
        filters: { online: true },
        sort: { field: 'gpa', direction: 'desc' },
      },
    })
  })
})
