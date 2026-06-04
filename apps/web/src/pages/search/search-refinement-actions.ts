import type {
  AdvancedSearchStateDto,
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchRecoveryGroup,
  SearchSort,
} from '@uiuc-course-search/query-types'
import {
  advancedFiltersForChipRemoval,
  advancedStateFromFilter,
  cleanAdvancedFilters,
  hasAdvancedFilterValue,
  meaningfulResidualQuery,
  removeChipFromQuery,
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
  visibleAdvanced?: AdvancedSearchStateDto
  sort?: SearchSort
}

export function planChipRemoval(
  chip: SearchChipDto,
  context: RefinementContext
): SearchRefinementPlan {
  const nextAdvancedFilters = advancedFiltersForChipRemoval(
    context.activeFilters,
    chip
  )
  if (nextAdvancedFilters) {
    const nextQuery = hasAdvancedFilterValue(nextAdvancedFilters)
      ? context.activeRequestQuery
      : context.typedQuery.trim()

    if (!nextQuery && !hasAdvancedFilterValue(nextAdvancedFilters)) {
      return { kind: 'clear', draft: nextAdvancedFilters }
    }

    return {
      kind: 'search',
      draft: nextAdvancedFilters,
      request: {
        query: nextQuery,
        filters: nextAdvancedFilters,
      },
    }
  }

  const nextQuery = removeChipFromQuery(
    context.activeRequestQuery || context.metaRawQuery || context.typedQuery,
    chip
  )

  if (!nextQuery) return { kind: 'noop' }

  return {
    kind: 'search',
    request: {
      query: nextQuery,
      filters: context.activeFilters,
    },
  }
}

export function planAmbiguityAction(
  action: SearchAmbiguityActionDto,
  context: RefinementContext
): SearchRefinementPlan {
  const actionFilters = advancedStateFromFilter(action.filter)
  if (hasAdvancedFilterValue(actionFilters)) {
    const baseFilters = cleanAdvancedFilters({
      ...context.activeFilters,
      ...(context.visibleAdvanced || {}),
    })
    if (action.filter.gened) {
      delete baseFilters.subject
      delete baseFilters.number
    }
    if (action.filter.subject) {
      delete baseFilters.gened
    }

    const nextFilters = cleanAdvancedFilters({
      ...baseFilters,
      ...actionFilters,
    })

    return {
      kind: 'search',
      draft: nextFilters,
      request: {
        query: meaningfulResidualQuery(context.residualQuery || ''),
        filters: nextFilters,
      },
    }
  }

  return {
    kind: 'search',
    request: {
      query:
        action.queryPatch?.replaceQuery ||
        action.queryPatch?.appendText ||
        action.label,
      filters: context.activeFilters,
    },
  }
}

export function planRecoveryAction(
  group: SearchRecoveryGroup,
  context: RefinementContext
): SearchRefinementPlan {
  return {
    kind: 'search',
    request: {
      query:
        group.queryPatch?.replaceQuery ||
        group.queryPatch?.appendText ||
        meaningfulResidualQuery(context.residualQuery || '') ||
        context.activeRequestQuery,
      filters: context.activeFilters,
      sort: context.sort,
    },
  }
}
