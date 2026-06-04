import { SlidersHorizontalIcon, XIcon } from 'lucide-react'
import type {
  AdvancedSearchStateDto,
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchMetaDto,
} from '@uiuc-course-search/query-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { AdvancedSearchFields } from './AdvancedSearchFields'
import { getChipClass } from './search-result-model'

export function RefinePanel({
  meta,
  resultCountLabel,
  advancedOpen,
  advancedDraft,
  hasAdvancedDraftChanges,
  onAdvancedOpenChange,
  onAdvancedDraftChange,
  onRemoveChip,
  onAmbiguityAction,
  onApplyAdvancedSearch,
  onResetAdvancedDraft,
}: {
  meta: SearchMetaDto
  resultCountLabel: string
  advancedOpen: boolean
  advancedDraft: AdvancedSearchStateDto
  hasAdvancedDraftChanges: boolean
  onAdvancedOpenChange: (open: boolean) => void
  onAdvancedDraftChange: <Key extends keyof AdvancedSearchStateDto>(
    key: Key,
    value: AdvancedSearchStateDto[Key]
  ) => void
  onRemoveChip: (chip: SearchChipDto) => void
  onAmbiguityAction: (action: SearchAmbiguityActionDto) => void
  onApplyAdvancedSearch: () => void
  onResetAdvancedDraft: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Refine results</h2>
            <p className="text-muted-foreground text-xs">
              {resultCountLabel}
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

        {meta.ui?.chips?.length ? (
          <div className="flex flex-wrap gap-2">
            {meta.ui.chips.map((chip) => (
              <Badge
                key={chip.id}
                variant={chip.type === 'semantic' ? 'outline' : 'secondary'}
                className={cn(
                  'h-auto min-h-5 py-0.5 normal-case',
                  getChipClass(chip)
                )}
              >
                {chip.label}
                {chip.removable && (
                  <Button
                    aria-label={`Remove ${chip.label}`}
                    size="icon-xs"
                    variant="ghost"
                    className="-mr-1 size-4 rounded-[var(--radius-sm)] p-0"
                    onClick={(event) => {
                      event.preventDefault()
                      onRemoveChip(chip)
                    }}
                  >
                    <XIcon aria-hidden />
                  </Button>
                )}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Searching by topic.</p>
        )}

        {meta.ui?.ambiguityActions?.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              Did you mean a different interpretation?
            </p>
            <div className="flex flex-wrap gap-2">
              {meta.ui.ambiguityActions.map((action) => (
                <Button
                  key={action.id}
                  size="xs"
                  variant="secondary"
                  onClick={() => onAmbiguityAction(action)}
                >
                  Use {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <Collapsible open={advancedOpen}>
          <CollapsibleContent
            id="advanced-search-panel"
            className="border-t pt-4"
          >
            <AdvancedSearchFields
              advancedDraft={advancedDraft}
              onAdvancedDraftChange={onAdvancedDraftChange}
            />

            <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-xs">
                Filters apply to the current search text.
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
                  disabled={!hasAdvancedDraftChanges}
                  onClick={onApplyAdvancedSearch}
                >
                  Apply filters
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
