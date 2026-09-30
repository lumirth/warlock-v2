import { SearchIcon } from 'lucide-react'
import type {
  SearchChipDto,
  SearchMetaDto,
} from '@warlock-v2/query-types'
import { Button } from '@/components/ui/button'

export function EmptyResults({
  meta,
  onRemoveChip,
}: {
  meta: SearchMetaDto
  onRemoveChip: (chip: SearchChipDto) => void
}) {
  const chip = meta.ui.chips[0]

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-6 text-center"
    >
      <div className="flex max-w-sm flex-col items-center gap-2">
        <span className="bg-muted flex size-8 items-center justify-center rounded-lg">
          <SearchIcon aria-hidden />
        </span>
        <h3 className="text-sm font-medium">Nothing matched that search.</h3>
        <p className="text-muted-foreground text-sm">
          Try removing a filter or using a broader phrase.
        </p>
      </div>
      {chip ? (
        <div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRemoveChip(chip)}
          >
            Remove one filter
          </Button>
        </div>
      ) : null}
    </div>
  )
}
