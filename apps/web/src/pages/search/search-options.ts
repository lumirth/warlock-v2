import {
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

export const TERM_OPTIONS: SelectOption[] = [
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
  { value: 'winter', label: 'Winter' },
]

export const TIME_OPTIONS: SelectOption[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
]

export const PART_OF_TERM_OPTIONS: SelectOption[] = [
  { value: '1', label: 'Full term' },
  { value: 'A', label: 'First half' },
  { value: 'B', label: 'Second half' },
]

export const DELIVERY_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Online' },
  { value: 'false', label: 'In person' },
]

export const STATUS_OPTIONS: SelectOption[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

export const WORKLOAD_OPTIONS: SelectOption[] = [
  { value: 'easy', label: 'Easier' },
  { value: 'hard', label: 'Harder' },
]

export const LEVEL_OPTIONS: SelectOption[] = [
  { value: '100', label: '100 level' },
  { value: '200', label: '200 level' },
  { value: '300', label: '300 level' },
  { value: '400', label: '400 level' },
  { value: '500', label: '500+ level' },
]

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
