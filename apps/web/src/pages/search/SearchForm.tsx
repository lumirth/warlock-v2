import type { FormEvent } from 'react'
import { SearchIcon } from 'lucide-react'
import { SEARCH_QUERY_MAX_LENGTH } from '@warlock-v2/query-types'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { FIRST_RUN_EXAMPLE_QUERIES } from './search-options'

export function SearchForm({
  query,
  showFirstRunExamples,
  onQueryChange,
  onSubmit,
  onExampleSearch,
}: {
  query: string
  showFirstRunExamples: boolean
  onQueryChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onExampleSearch: (query: string) => void
}) {
  return (
    <>
      <form role="search" autoComplete="off" onSubmit={onSubmit}>
        <Field>
          <FieldLabel htmlFor="course-search-query" className="sr-only">
            Course search query
          </FieldLabel>
          <div className="border-input focus-within:border-ring focus-within:ring-ring/50 bg-card flex h-10 items-center gap-2 rounded-lg border px-3 focus-within:ring-3">
            <SearchIcon className="text-muted-foreground size-4" aria-hidden />
            <input
              id="course-search-query"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              placeholder="Search by course, topic, professor, GenEd, or time"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <Button type="submit" size="icon-sm" aria-label="Search courses">
              <SearchIcon aria-hidden />
            </Button>
          </div>
        </Field>
      </form>

      {showFirstRunExamples && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            Search UIUC courses the way you'd describe them.
          </p>
          <div className="flex flex-wrap gap-2">
            {FIRST_RUN_EXAMPLE_QUERIES.map((exampleQuery) => (
              <Button
                key={exampleQuery}
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => onExampleSearch(exampleQuery)}
              >
                {exampleQuery}
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
