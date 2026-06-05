import type { FormEvent } from 'react'
import { SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
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
          <InputGroup className="bg-card h-10">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              id="course-search-query"
              autoComplete="off"
              placeholder="Search by course, topic, professor, GenEd, or time"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </InputGroup>
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
