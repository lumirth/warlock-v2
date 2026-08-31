import { SlidersHorizontalIcon, XIcon } from 'lucide-react'
import type {
  AdvancedSearchStateDto,
  SearchRequestFilterKey,
  SearchRequestFiltersDto,
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchMetaDto,
  SearchScope,
  SearchTermOptionDto,
} from '@uiuc-course-search/query-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AdvancedSearchFields } from './AdvancedSearchFields'
import { getChipClass } from './search-result-model'
import type { AdvancedFilterErrors } from './search-filter-model'

export function RefinePanel({
  meta,
  resultCountLabel,
  availableTerms,
  termOptionsError,
  termOptionsLoading,
  advancedDraftErrors,
  hasAdvancedDraftErrors,
  advancedOpen,
  advancedDraft,
  hasAdvancedDraftChanges,
  onAdvancedOpenChange,
  onAdvancedDraftFilterChange,
  onAdvancedDraftScopeChange,
  onRemoveChip,
  onAmbiguityAction,
  onApplyAdvancedSearch,
  onResetAdvancedDraft,
  onRetryTermOptions,
}: {
  meta: SearchMetaDto | null
  resultCountLabel?: string
  availableTerms?: SearchTermOptionDto[]
  termOptionsError: boolean
  termOptionsLoading: boolean
  advancedDraftErrors: AdvancedFilterErrors
  hasAdvancedDraftErrors: boolean
  advancedOpen: boolean
  advancedDraft: AdvancedSearchStateDto
  hasAdvancedDraftChanges: boolean
  onAdvancedOpenChange: (open: boolean) => void
  onAdvancedDraftFilterChange: <Key extends SearchRequestFilterKey>(
    key: Key,
    value: SearchRequestFiltersDto[Key]
  ) => void
  onAdvancedDraftScopeChange: (value?: SearchScope) => void
  onRemoveChip: (chip: SearchChipDto) => void
  onAmbiguityAction: (action: SearchAmbiguityActionDto) => void
  onApplyAdvancedSearch: () => void
  onResetAdvancedDraft: () => void
  onRetryTermOptions: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {meta ? 'Refine results' : 'Search filters'}
            </h2>
            <p className="text-muted-foreground text-xs">
              {meta
                ? resultCountLabel
                : 'Choose filters before or after searching.'}
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            aria-expanded={advancedOpen}
            aria-controls="advanced-search-panel"
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
          >
            <SlidersHorizontalIcon data-icon="inline-start" aria-hidden />
            Advanced search
          </Button>
        </div>

        <Interpretation meta={meta} onRemoveChip={onRemoveChip} onAmbiguityAction={onAmbiguityAction} />

        {advancedOpen && (
          <div id="advanced-search-panel" className="border-t pt-4">
            <AdvancedSearchFields
              advancedDraft={advancedDraft}
              availableTerms={availableTerms}
              termOptionsError={termOptionsError}
              termOptionsLoading={termOptionsLoading}
              errors={advancedDraftErrors}
              onRetryTermOptions={onRetryTermOptions}
              onAdvancedDraftFilterChange={onAdvancedDraftFilterChange}
              onAdvancedDraftScopeChange={onAdvancedDraftScopeChange}
            />

            <div className="bg-card sticky bottom-0 -mx-1 mt-4 flex flex-col gap-3 border-t px-1 py-4 sm:static sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-xs">
                {hasAdvancedDraftErrors
                  ? 'Correct the highlighted fields before applying.'
                  : 'Filters apply to the current search text.'}
              </p>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!hasAdvancedDraftChanges}
                  onClick={onResetAdvancedDraft}
                >
                  Reset fields
                </Button>
                <Button
                  size="xs"
                  disabled={!hasAdvancedDraftChanges || hasAdvancedDraftErrors}
                  onClick={onApplyAdvancedSearch}
                >
                  Apply filters
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Interpretation({ meta, onRemoveChip, onAmbiguityAction }: {
  meta: SearchMetaDto | null
  onRemoveChip: (chip: SearchChipDto) => void
  onAmbiguityAction: (action: SearchAmbiguityActionDto) => void
}) {
  const chips = meta?.ui.chips ?? []
  return <>
    {chips.length ? <div aria-label="Active search filters" className="flex flex-wrap gap-2">
      {chips.map((chip) => <SearchChipBadge key={chip.id} chip={chip} onRemoveChip={onRemoveChip} />)}
    </div> : meta ? <p className="text-muted-foreground text-sm">Searching by topic.</p> : null}
    {meta?.ui.ambiguityActions.length ? <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">Did you mean a different interpretation?</p>
      <div className="flex flex-wrap gap-2">{meta.ui.ambiguityActions.map((action) =>
        <Button key={action.id} size="xs" variant="secondary" onClick={() => onAmbiguityAction(action)}>Use {action.label}</Button>
      )}</div>
    </div> : null}
  </>
}

function SearchChipBadge({
  chip,
  onRemoveChip,
}: {
  chip: SearchChipDto
  onRemoveChip: (chip: SearchChipDto) => void
}) {
  return (
    <Badge
      variant={chip.type === 'semantic' ? 'outline' : 'secondary'}
      className={cn('h-auto min-h-5 py-0.5 normal-case', getChipClass(chip))}
    >
      {chip.label}
      <Button
        aria-label={`Remove ${chip.label}`}
        size="icon-xs"
        variant="ghost"
        className="-mr-1 rounded-[var(--radius-sm)] p-0"
        onClick={(event) => {
          event.preventDefault()
          onRemoveChip(chip)
        }}
      >
        <XIcon aria-hidden />
      </Button>
    </Badge>
  )
}
