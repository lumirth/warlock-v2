import type { SearchScope, SearchSort } from '@uiuc-course-search/query-types';
import type { SearchResult } from '../search-types.js';
import { appendScoreComponents, scoreComponent } from './score-utils.js';
import { sortValueForResult } from './sort-policy.js';

export type FinalOrderingControls = {
  sort: SearchSort;
  scope: SearchScope;
};

export function applyFinalOrderingControls(
  results: SearchResult[],
  controls: FinalOrderingControls,
  context: { hasExplicitTermFilter?: boolean } = {},
): SearchResult[] {
  const resultsWithoutStaleSortTrace = results.map(removeAttributeSortComponent);
  const scopedResults =
    controls.scope === 'active' && !context.hasExplicitTermFilter
      ? resultsWithoutStaleSortTrace.filter((result) => result.historical !== true)
      : resultsWithoutStaleSortTrace;

  if (controls.sort.field === 'relevance') {
    return scopedResults;
  }

  return scopedResults
    .map((result, relevanceIndex) => ({
      result,
      relevanceIndex,
      value: sortValueForResult(result, controls.sort.field),
    }))
    .sort((left, right) => compareSortItems(left, right, controls.sort))
    .map((item) => appendAttributeSortComponent(item.result, controls.sort, item.value));
}

function compareSortItems(
  left: { value: number | null; relevanceIndex: number },
  right: { value: number | null; relevanceIndex: number },
  sort: SearchSort,
): number {
  if (left.value === null && right.value === null) {
    return left.relevanceIndex - right.relevanceIndex;
  }
  if (left.value === null) return 1;
  if (right.value === null) return -1;

  if (left.value !== right.value) {
    return sort.direction === 'asc'
      ? left.value - right.value
      : right.value - left.value;
  }

  return left.relevanceIndex - right.relevanceIndex;
}

function appendAttributeSortComponent(
  result: SearchResult,
  sort: SearchSort,
  value: number | null,
): SearchResult {
  const fieldLabel = sortFieldLabel(sort.field);
  const directionLabel = sort.direction === 'asc' ? 'ascending' : 'descending';
  const valueEvidence = value === null
    ? `${fieldLabel} unavailable; sorted after courses with data.`
    : `${fieldLabel}: ${formatSortValue(sort.field, value)}.`;

  return {
    ...result,
    scoreComponents: appendScoreComponents(result.scoreComponents, [
      scoreComponent(
        'attribute_sort',
        0,
        `Sorted by ${fieldLabel} (${directionLabel}); relevance breaks ties.`,
        [valueEvidence],
      ),
    ]),
  };
}

function removeAttributeSortComponent(result: SearchResult): SearchResult {
  const scoreComponents = result.scoreComponents?.filter(component => component.name !== 'attribute_sort');
  if (scoreComponents?.length === result.scoreComponents?.length) {
    return result;
  }

  return {
    ...result,
    scoreComponents,
  };
}

function sortFieldLabel(field: SearchSort['field']): string {
  switch (field) {
    case 'gpa':
      return 'Avg GPA';
    case 'quality':
      return 'Quality tier';
    case 'workload':
      return 'Workload tier';
    case 'instructor_rating':
      return 'Instructor rating';
    case 'level':
      return 'Course level';
    case 'credits':
      return 'Credits';
    case 'relevance':
      return 'Relevance';
  }
}

function formatSortValue(field: SearchSort['field'], value: number): string {
  if (field === 'gpa' || field === 'instructor_rating') {
    return value.toFixed(2);
  }
  return String(value);
}
