import {
  SEARCH_LEVEL_VALUES,
  SEARCH_SORT_FIELDS,
  SEARCH_STATUS_VALUES,
  SEARCH_TIME_VALUES,
  SEARCH_INSTRUCTOR_DIFFICULTY_VALUES,
  type SortField,
} from '@uiuc-course-search/query-types'

export const ANY_SELECT_VALUE = '__any__'

export type SelectOption = {
  value: string
  label: string
}

type SortFieldOption = SelectOption & {
  value: SortField
}

export type TableSortColumn = {
  field: Exclude<SortField, 'relevance'>
  label: string
  className?: string
}

const TIME_LABELS = {
  early: 'Early · before 9 AM',
  morning: 'Morning · before noon',
  midday: 'Midday · 10 AM–2 PM',
  afternoon: 'Afternoon · noon–5 PM',
  evening: 'Evening · after 5 PM',
} as const satisfies Record<(typeof SEARCH_TIME_VALUES)[number], string>

const STATUS_LABELS = {
  open: 'Open only',
  available: 'Open or restricted',
  closed: 'Closed',
} as const satisfies Record<(typeof SEARCH_STATUS_VALUES)[number], string>

const INSTRUCTOR_DIFFICULTY_LABELS = {
  lower: 'Lower instructor-rated difficulty',
  higher: 'Higher instructor-rated difficulty',
} as const satisfies Record<
  (typeof SEARCH_INSTRUCTOR_DIFFICULTY_VALUES)[number],
  string
>

const SORT_FIELD_LABELS = {
  relevance: 'Relevance',
  gpa: 'Avg GPA',
  quality: 'Quality signal',
  instructor_difficulty: 'Instructor difficulty',
  instructor_rating: 'RMP rating',
  level: 'Level',
  credits: 'Credits',
} as const satisfies Record<SortField, string>

export const TIME_OPTIONS: SelectOption[] = SEARCH_TIME_VALUES.map((value) => ({
  value,
  label: TIME_LABELS[value],
}))

export const PART_OF_TERM_OPTIONS: SelectOption[] = [
  { value: '1', label: 'Full term' },
  { value: 'A', label: 'First half' },
  { value: 'B', label: 'Second half' },
]

export const DELIVERY_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Online' },
  { value: 'false', label: 'In person' },
]

export const CREDIT_OPTIONS: SelectOption[] = Array.from(
  { length: 9 },
  (_, value) => ({
    value: String(value),
    label: value === 1 ? 'Exactly 1 credit' : `Exactly ${value} credits`,
  })
)

export const STATUS_OPTIONS: SelectOption[] = SEARCH_STATUS_VALUES.map(
  (value) => ({
    value,
    label: STATUS_LABELS[value],
  })
)

export const INSTRUCTOR_DIFFICULTY_OPTIONS: SelectOption[] =
  SEARCH_INSTRUCTOR_DIFFICULTY_VALUES.map(
  (value) => ({
    value,
    label: INSTRUCTOR_DIFFICULTY_LABELS[value],
  })
)

export const LEVEL_OPTIONS: SelectOption[] = SEARCH_LEVEL_VALUES.map(
  (value) => ({
    value: String(value),
    label: value === 500 ? '500+ level' : `${value} level`,
  })
)

export const SORT_FIELD_OPTIONS: SortFieldOption[] = SEARCH_SORT_FIELDS.map(
  (value) => ({
    value,
    label: SORT_FIELD_LABELS[value],
  })
)

export const TABLE_SORT_COLUMNS: TableSortColumn[] = SEARCH_SORT_FIELDS.filter(
  (field): field is Exclude<SortField, 'relevance'> => field !== 'relevance'
).map((field) => ({ field, label: SORT_FIELD_LABELS[field] }))

export const FIRST_RUN_EXAMPLE_QUERIES = [
  'CS 225',
  'cultural studies gen ed online',
  'data structures with fagen',
  'online stats class',
  '4 credit humanities gen ed no friday classes',
]
