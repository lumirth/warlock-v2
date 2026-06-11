import { SearchIcon } from 'lucide-react'
import type {
  SearchChipDto,
  SearchMetaDto,
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

export function EmptyResults({
  meta,
  onRemoveChip,
}: {
  meta: SearchMetaDto
  onRemoveChip: (chip: SearchChipDto) => void
}) {
  const chip = meta.ui.chips[0]

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
      {chip ? (
        <EmptyContent>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRemoveChip(chip)}
          >
            Remove one filter
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
