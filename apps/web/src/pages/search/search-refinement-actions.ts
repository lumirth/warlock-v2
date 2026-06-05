import type {
  AdvancedSearchStateDto,
  SearchAmbiguityActionDto,
  SearchActionDto,
  SearchChipDto,
  SearchRequestDto,
  SearchRecoveryGroup,
} from '@uiuc-course-search/query-types'
import {
  cleanAdvancedFilters,
  advancedStateFromRequest,
  hasSearchableAdvancedFilterValue,
} from './search-filter-model'

export type SearchRefinementPlan =
  | {
      kind: 'search'
      request: SearchRequestDto
      draft?: AdvancedSearchStateDto
    }
  | {
      kind: 'clear'
      draft?: AdvancedSearchStateDto
    }
  | { kind: 'noop' }

export function planChipRemoval(
  chip: SearchChipDto
): SearchRefinementPlan {
  return planSearchAction(chip.action)
}

export function planAmbiguityAction(
  action: SearchAmbiguityActionDto
): SearchRefinementPlan {
  return planSearchAction(action.action)
}

export function planRecoveryAction(
  group: SearchRecoveryGroup
): SearchRefinementPlan {
  return planSearchAction(group.action)
}

function planSearchAction(action: SearchActionDto | undefined): SearchRefinementPlan {
  if (!action) return { kind: 'noop' }

  const nextFilters = advancedStateFromRequest(action.nextRequest)
  const nextQuery = action.nextRequest.query.trim()
  const draft = cleanAdvancedFilters(nextFilters)

  if (!nextQuery && !hasSearchableAdvancedFilterValue(draft)) {
    return { kind: 'clear', draft }
  }

  return {
    kind: 'search',
    draft,
    request: action.nextRequest,
  }
}
