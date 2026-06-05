import type {
  AdvancedSearchStateDto,
  SearchAmbiguityActionDto,
  SearchActionDto,
  SearchChipDto,
  SearchRecoveryGroup,
  SearchSort,
} from '@uiuc-course-search/query-types'
import {
  cleanAdvancedFilters,
  advancedStateFromRequest,
  hasSearchableAdvancedFilterValue,
} from './search-filter-model'

export type SearchRefinementRequest = {
  query: string
  filters: AdvancedSearchStateDto
  sort?: SearchSort
}

export type SearchRefinementPlan =
  | {
      kind: 'search'
      request: SearchRefinementRequest
      draft?: AdvancedSearchStateDto
    }
  | {
      kind: 'clear'
      draft?: AdvancedSearchStateDto
    }
  | { kind: 'noop' }

export type RefinementContext = {
  activeRequestQuery: string
  typedQuery: string
  metaRawQuery?: string
  residualQuery?: string
  activeFilters: AdvancedSearchStateDto
  sort?: SearchSort
}

export function planChipRemoval(
  chip: SearchChipDto,
  context: RefinementContext
): SearchRefinementPlan {
  return planSearchAction(chip.action, context)
}

export function planAmbiguityAction(
  action: SearchAmbiguityActionDto,
  context: RefinementContext
): SearchRefinementPlan {
  return planSearchAction(action.action, context)
}

export function planRecoveryAction(
  group: SearchRecoveryGroup,
  context: RefinementContext
): SearchRefinementPlan {
  return planSearchAction(group.action, context)
}

function planSearchAction(
  action: SearchActionDto | undefined,
  context: RefinementContext
): SearchRefinementPlan {
  if (!action) return { kind: 'noop' }

  const nextFilters = advancedStateFromRequest(action.nextRequest)
  const nextQuery = action.nextRequest.query.trim()
  const nextSort = action.nextRequest.sort ?? context.sort
  const draft = cleanAdvancedFilters(nextFilters)

  if (!nextQuery && !hasSearchableAdvancedFilterValue(draft)) {
    return { kind: 'clear', draft }
  }

  return {
    kind: 'search',
    draft,
    request: {
      query: nextQuery,
      filters: draft,
      sort: nextSort,
    },
  }
}
