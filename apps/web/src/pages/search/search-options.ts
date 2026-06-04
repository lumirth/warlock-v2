import {
  SEARCH_LEVEL_OPTIONS as SEARCH_LEVEL_OPTIONS_CONTRACT,
  SEARCH_STATUS_OPTIONS as SEARCH_STATUS_OPTIONS_CONTRACT,
  SEARCH_TERM_OPTIONS as SEARCH_TERM_OPTIONS_CONTRACT,
  SEARCH_TIME_OPTIONS as SEARCH_TIME_OPTIONS_CONTRACT,
  SEARCH_WORKLOAD_OPTIONS as SEARCH_WORKLOAD_OPTIONS_CONTRACT,
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

export const TERM_OPTIONS: SelectOption[] = SEARCH_TERM_OPTIONS_CONTRACT.map(
  (option) => ({ ...option })
)

export const TIME_OPTIONS: SelectOption[] = SEARCH_TIME_OPTIONS_CONTRACT.map(
  (option) => ({ ...option })
)

export const PART_OF_TERM_OPTIONS: SelectOption[] = [
  { value: '1', label: 'Full term' },
  { value: 'A', label: 'First half' },
  { value: 'B', label: 'Second half' },
]

export const DELIVERY_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Online' },
  { value: 'false', label: 'In person' },
]

export const STATUS_OPTIONS: SelectOption[] = SEARCH_STATUS_OPTIONS_CONTRACT.map(
  (option) => ({ ...option })
)

export const WORKLOAD_OPTIONS: SelectOption[] = SEARCH_WORKLOAD_OPTIONS_CONTRACT.map(
  (option) => ({ ...option })
)

export const LEVEL_OPTIONS: SelectOption[] = SEARCH_LEVEL_OPTIONS_CONTRACT.map(
  (option) => ({ value: String(option.value), label: option.label })
)

export const SORT_FIELD_OPTIONS: SortFieldOption[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'gpa', label: 'Avg GPA' },
  { value: 'quality', label: 'Quality' },
  { value: 'workload', label: 'Workload' },
  { value: 'instructor_rating', label: 'Instructor rating' },
  { value: 'level', label: 'Level' },
  { value: 'credits', label: 'Credits' },
]

export const TABLE_SORT_COLUMNS: TableSortColumn[] = [
  { field: 'quality', label: 'Quality' },
  { field: 'workload', label: 'Workload' },
  { field: 'gpa', label: 'Avg GPA' },
  { field: 'instructor_rating', label: 'Instructor rating' },
  { field: 'level', label: 'Level' },
  { field: 'credits', label: 'Credits' },
]

export const FIRST_RUN_EXAMPLE_QUERIES = [
  'CS 225',
  'easy cs gened',
  'data structures with fagen',
  'online stats class',
  '4 credit hum no friday classes',
]
