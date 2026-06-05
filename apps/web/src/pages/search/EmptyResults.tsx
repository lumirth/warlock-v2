import { SearchIcon } from 'lucide-react'
import type {
  SearchChipDto,
  SearchMetaDto,
  SearchRecoveryGroup,
} from '@uiuc-course-search/query-types'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { recoveryButtonLabel } from './search-result-model'

export function EmptyResults({
  meta,
  recoveryGroups,
  onRemoveChip,
  onApplyRecoveryGroup,
}: {
  meta: SearchMetaDto
  recoveryGroups: SearchRecoveryGroup[]
  onRemoveChip: (chip: SearchChipDto) => void
  onApplyRecoveryGroup: (group: SearchRecoveryGroup) => void
}) {
  const removableChip = meta.ui?.chips.find((chip) => chip.removable)

  return (
    <Empty role="status" className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Nothing matched that search.</EmptyTitle>
        <EmptyDescription>
          Try removing a filter or using a broader phrase.
        </EmptyDescription>
      </EmptyHeader>
      {removableChip || recoveryGroups.length ? (
        <EmptyContent>
          {removableChip ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => onRemoveChip(removableChip)}
            >
              Remove one filter
            </Button>
          ) : null}
          {recoveryGroups.length ? (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-muted-foreground text-xs">
                Or broaden the search while keeping the useful parts.
              </p>
              <div className="flex flex-wrap gap-2">
                {recoveryGroups.map((group) => (
                  <Button
                    key={group.id}
                    size="xs"
                    variant="secondary"
                    onClick={() => onApplyRecoveryGroup(group)}
                    title={group.description}
                  >
                    {recoveryButtonLabel(group)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
