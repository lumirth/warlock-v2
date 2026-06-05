import {
  SEARCH_LEVEL_VALUES,
  SEARCH_SORT_FIELDS,
  SEARCH_STATUS_VALUES,
  SEARCH_TERM_VALUES,
  SEARCH_TIME_VALUES,
  SEARCH_WORKLOAD_VALUES,
  type SortField,
} from '@uiuc-course-search/query-types'

export const SEARCH_PAGE_SIZE = 20
export const ANY_SELECT_VALUE = '__any__'

export type SelectOption = {
  value: string
  label: string
}

export type SortFieldOption = SelectOption & {
  value: SortField
}

export type TableSortColumn = {
  field: Exclude<SortField, 'relevance'>
  label: string
  className?: string
}

const TERM_LABELS = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
} as const satisfies Record<(typeof SEARCH_TERM_VALUES)[number], string>

const TIME_LABELS = {
  early: 'Early',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
} as const satisfies Record<(typeof SEARCH_TIME_VALUES)[number], string>

const STATUS_LABELS = {
  open: 'Open',
  available: 'Available',
  closed: 'Closed',
} as const satisfies Record<(typeof SEARCH_STATUS_VALUES)[number], string>

const WORKLOAD_LABELS = {
  easy: 'Easier',
  hard: 'Harder',
} as const satisfies Record<(typeof SEARCH_WORKLOAD_VALUES)[number], string>

const SORT_FIELD_LABELS = {
  relevance: 'Relevance',
  gpa: 'Avg GPA',
  quality: 'Quality',
  workload: 'Workload',
  instructor_rating: 'Instructor rating',
  level: 'Level',
  credits: 'Credits',
} as const satisfies Record<SortField, string>

export const TERM_OPTIONS: SelectOption[] = SEARCH_TERM_VALUES.map((value) => ({
  value,
  label: TERM_LABELS[value],
}))

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

export const STATUS_OPTIONS: SelectOption[] = SEARCH_STATUS_VALUES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}))

export const WORKLOAD_OPTIONS: SelectOption[] = SEARCH_WORKLOAD_VALUES.map((value) => ({
  value,
  label: WORKLOAD_LABELS[value],
}))

export const LEVEL_OPTIONS: SelectOption[] = SEARCH_LEVEL_VALUES.map((value) => ({
  value: String(value),
  label: value === 500 ? '500+ level' : `${value} level`,
}))

export const SORT_FIELD_OPTIONS: SortFieldOption[] = SEARCH_SORT_FIELDS.map((value) => ({
  value,
  label: SORT_FIELD_LABELS[value],
}))

export const TABLE_SORT_COLUMNS: TableSortColumn[] = SEARCH_SORT_FIELDS
  .filter((field): field is Exclude<SortField, 'relevance'> => field !== 'relevance')
  .map((field) => ({ field, label: SORT_FIELD_LABELS[field] }))

export const FIRST_RUN_EXAMPLE_QUERIES = [
  'CS 225',
  'easy cs gened',
  'data structures with fagen',
  'online stats class',
  '4 credit hum no friday classes',
]
