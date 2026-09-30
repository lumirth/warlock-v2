import {
  ArrowDownIcon,
  ArrowUpIcon,
  LayoutGridIcon,
  Table2Icon,
} from 'lucide-react'
import {
  isSearchSortField,
  type SearchSort,
  type SortField,
} from '@warlock-v2/query-types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SORT_FIELD_OPTIONS } from './search-options'
import { directionLabel, type ResultViewMode } from './search-sort-model'

export function ResultsToolbar({
  showingResultsLabel,
  sort,
  resultViewMode,
  isRefreshing,
  onSortFieldChange,
  onDirectionToggle,
  onViewChange,
}: {
  showingResultsLabel: string
  sort: SearchSort
  resultViewMode: ResultViewMode
  isRefreshing: boolean
  onSortFieldChange: (field: SortField) => void
  onDirectionToggle: () => void
  onViewChange: (view: ResultViewMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        {showingResultsLabel}
      </p>
      {isRefreshing && (
        <span
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex items-center gap-1 text-xs"
        >
          <Spinner aria-hidden />
          Updating results
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Sort</span>
        <div className="w-40">
          <label htmlFor="results-sort-field" className="sr-only">
            Sort results
          </label>
          <select
            id="results-sort-field"
            aria-label="Sort results"
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3"
            value={sort.field}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (isSearchSortField(value)) {
                onSortFieldChange(value)
              }
            }}
          >
            {SORT_FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {sort.field !== 'relevance' && (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`Sort ${directionLabel(sort.direction).toLowerCase()}`}
            onClick={onDirectionToggle}
          >
            {sort.direction === 'asc' ? (
              <ArrowUpIcon aria-hidden />
            ) : (
              <ArrowDownIcon aria-hidden />
            )}
          </Button>
        )}
        <div
          className="bg-background flex rounded-md border p-0.5"
          role="group"
          aria-label="Result view"
        >
          <Button
            type="button"
            size="xs"
            variant={resultViewMode === 'cards' ? 'secondary' : 'ghost'}
            aria-pressed={resultViewMode === 'cards'}
            onClick={() => onViewChange('cards')}
          >
            <LayoutGridIcon data-icon="inline-start" aria-hidden />
            Cards
          </Button>
          <Button
            type="button"
            size="xs"
            variant={resultViewMode === 'table' ? 'secondary' : 'ghost'}
            aria-pressed={resultViewMode === 'table'}
            onClick={() => onViewChange('table')}
          >
            <Table2Icon data-icon="inline-start" aria-hidden />
            Table
          </Button>
        </div>
      </div>
    </div>
  )
}
