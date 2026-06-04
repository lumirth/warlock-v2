import type { AdvancedSearchStateDto } from '@uiuc-course-search/query-types'
import {
  advancedFiltersChanged,
  advancedFiltersContradictQuery,
  cleanAdvancedFilters,
  hasAdvancedFilterValue,
  meaningfulResidualQuery,
} from './search-filter-model'

export type AdvancedSearchApplyContext = {
  activeRequestQuery: string
  currentInputQuery: string
  inputDirty: boolean
  interpretedAdvanced: AdvancedSearchStateDto
  draft: AdvancedSearchStateDto
  residualQuery?: string
}

export type AdvancedSearchApplyPlan =
  | {
      kind: 'search'
      query: string
      filters: AdvancedSearchStateDto
      syncInputQuery?: string
    }
  | { kind: 'clear' }

export function planAdvancedSearchApply(
  context: AdvancedSearchApplyContext
): AdvancedSearchApplyPlan {
  const changed = advancedFiltersChanged(
    context.interpretedAdvanced,
    context.draft
  )
  const contradictsQuery = advancedFiltersContradictQuery(
    context.interpretedAdvanced,
    context.draft
  )
  const freeTextQuery = freeTextForAdvancedApply(context, contradictsQuery)
  const filters = cleanAdvancedFilters(context.draft)
  const query = changed ? freeTextQuery : context.activeRequestQuery

  if (!query.trim() && !hasAdvancedFilterValue(filters)) {
    return { kind: 'clear' }
  }

  return {
    kind: 'search',
    query,
    filters,
    ...(contradictsQuery && !context.inputDirty
      ? { syncInputQuery: freeTextQuery }
      : {}),
  }
}

function freeTextForAdvancedApply(
  context: AdvancedSearchApplyContext,
  contradictsQuery: boolean
): string {
  if (context.inputDirty) return context.currentInputQuery.trim()
  if (contradictsQuery) {
    return meaningfulResidualQuery(context.residualQuery || '')
  }
  return context.activeRequestQuery
}
