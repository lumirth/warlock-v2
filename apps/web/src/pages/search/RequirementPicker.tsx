import {
  canonicalRequirementCodes,
  GENED_DISPLAY_NAME,
  GENED_REQUIREMENT_GROUPS,
  requirementFilter,
  type SearchRequestFiltersDto,
} from '@uiuc-course-search/query-types'

type Requirement = SearchRequestFiltersDto['requirement']
type Mode = 'any' | 'all'

function makeRequirement(values: Iterable<string>, mode: Mode): Requirement {
  const codes = canonicalRequirementCodes([...values])
  return codes.length ? requirementFilter(codes.length === 1 ? 'single' : mode, codes) : undefined
}

export function RequirementPicker({ value, onChange }: {
  value: Requirement
  onChange: (value: Requirement) => void
}) {
  const selected = new Set(canonicalRequirementCodes(value?.codes))
  const mode: Mode = value?.mode === 'all' ? 'all' : 'any'
  const toggle = (code: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(code)
    else next.delete(code)
    onChange(makeRequirement(next, mode))
  }

  return <details className="bg-background rounded-md border px-3 py-3">
    <summary className="cursor-pointer text-sm font-medium">
      {GENED_DISPLAY_NAME} categories
      <span className="text-muted-foreground ml-2 text-xs font-normal">
        {selected.size ? `${selected.size} selected: ${[...selected].sort().join(', ')}` : 'none selected'}
      </span>
    </summary>
    {selected.size > 1 && <label className="mt-3 flex items-center gap-2 border-b pb-3 text-sm font-medium">
      Match
      <select
        className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        value={mode}
        onChange={(event) => onChange(makeRequirement(selected, event.currentTarget.value === 'all' ? 'all' : 'any'))}
      >
        <option value="any">Any selected category</option>
        <option value="all">Every selected category</option>
      </select>
    </label>}
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {GENED_REQUIREMENT_GROUPS.map((group) => <div key={group.code} className="flex flex-col gap-2">
        <Option code={group.code} label={group.label} checked={selected.has(group.code)} onChange={toggle} />
        {group.options.length > 0 && <div className="ml-6 flex flex-col gap-1.5 border-l pl-3">
          {group.options.map((option) => <Option
            key={option.code}
            code={option.code}
            label={option.label}
            checked={selected.has(option.code)}
            onChange={toggle}
          />)}
        </div>}
      </div>)}
    </div>
  </details>
}

function Option({ code, label, checked, onChange }: {
  code: string
  label: string
  checked: boolean
  onChange: (code: string, checked: boolean) => void
}) {
  return <label className="hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-sm p-1 text-sm">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(code, event.currentTarget.checked)} className="accent-primary size-5" />
    <span className="min-w-0 truncate">{label} <small className="text-muted-foreground">{code}</small></span>
  </label>
}
