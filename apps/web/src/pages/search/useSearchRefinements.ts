import type { Dispatch } from 'react'
import type {
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchRecoveryGroup,
} from '@uiuc-course-search/query-types'
import type {
  SearchControllerAction,
} from './search-controller-state'
import {
  planAmbiguityAction,
  planChipRemoval,
  planRecoveryAction,
  type SearchRefinementPlan,
} from './search-refinement-actions'
import type { ExecuteSearch } from './useSearchExecution'

export function useSearchRefinements({
  dispatch,
  executeSearch,
}: {
  dispatch: Dispatch<SearchControllerAction>
  executeSearch: ExecuteSearch
}) {
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
      type: 'request',
      mode: 'refine',
      request: plan.request,
    })
  }

  return {
    removeChip: (chip: SearchChipDto) =>
      runRefinementPlan(planChipRemoval(chip)),
    applyAmbiguityAction: (action: SearchAmbiguityActionDto) =>
      runRefinementPlan(planAmbiguityAction(action)),
    applyRecoveryGroup: (group: SearchRecoveryGroup) =>
      runRefinementPlan(planRecoveryAction(group)),
  }
}
