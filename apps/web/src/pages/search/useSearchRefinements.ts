import type { Dispatch } from 'react'
import type {
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchRecoveryGroup,
} from '@uiuc-course-search/query-types'
import type {
  SearchControllerAction,
  SearchControllerState,
} from './search-controller-state'
import {
  planAmbiguityAction,
  planChipRemoval,
  planRecoveryAction,
  type SearchRefinementPlan,
} from './search-refinement-actions'
import type { SearchViewModel } from './search-view-model'
import type { ExecuteSearch } from './useSearchExecution'

export function useSearchRefinements({
  state,
  derived,
  dispatch,
  executeSearch,
}: {
  state: SearchControllerState
  derived: SearchViewModel
  dispatch: Dispatch<SearchControllerAction>
  executeSearch: ExecuteSearch
}) {
  const context = {
    activeRequestQuery: derived.activeRequestQuery,
    typedQuery: state.query,
    metaRawQuery: state.meta?.query.raw,
    residualQuery: state.meta?.query.residual,
    activeFilters: state.activeAdvancedFilters,
    visibleAdvanced: state.meta?.ui?.advanced,
    sort: state.sort,
  }

  const runRefinementPlan = (plan: SearchRefinementPlan) => {
    if (plan.kind === 'noop') return
    if (plan.draft) {
      dispatch({ type: 'advanced/draft-replaced', value: plan.draft })
    }
    if (plan.kind === 'clear') {
      dispatch({ type: 'search/cleared' })
      return
    }

    executeSearch({
      type: 'refine',
      query: plan.request.query,
      filters: plan.request.filters,
      sort: plan.request.sort,
    })
  }

  return {
    removeChip: (chip: SearchChipDto) =>
      runRefinementPlan(planChipRemoval(chip, context)),
    applyAmbiguityAction: (action: SearchAmbiguityActionDto) =>
      runRefinementPlan(planAmbiguityAction(action, context)),
    applyRecoveryGroup: (group: SearchRecoveryGroup) =>
      runRefinementPlan(planRecoveryAction(group, context)),
  }
}
