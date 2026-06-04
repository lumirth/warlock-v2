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
} from '@uiuc-course-search/query-types'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { SORT_FIELD_OPTIONS } from './search-options'
import {
  directionLabel,
  type ResultViewMode,
} from './search-sort-model'

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
        <Field className="w-40">
          <FieldLabel htmlFor="results-sort-field" className="sr-only">
            Sort results
          </FieldLabel>
          <Select
            value={sort.field}
            onValueChange={(value) => {
              if (isSearchSortField(value)) {
                onSortFieldChange(value)
              }
            }}
          >
            <SelectTrigger id="results-sort-field" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SORT_FIELD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
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
          className="flex rounded-md border bg-background p-0.5"
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
