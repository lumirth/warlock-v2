import type { TermStatus } from '@uiuc-course-search/query-types';

export type TermStateStatus = TermStatus;
export type SyncRunStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface Subject {
  id: string;
  name: string;
  college_code: string | null;
  department_code: string | null;
  unit_name: string | null;
  contact_name: string | null;
  contact_title: string | null;
  address_line1: string | null;
  address_line2: string | null;
  phone_number: string | null;
  website_url: string | null;
  description: string | null;
  last_synced: number | null;
}

export interface Instructor {
  id: number;
  first_name: string | null;
  last_name: string;
  display_name: string;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  avg_gpa: number | null;
  median_gpa?: number | null;
  gpa_sample_size: number | null;
}

export type InstructorLinkReadRow = Partial<{
  instructor_name: string | null;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  rmp_id: string | null;
  avg_gpa: number | null;
  median_gpa: number | null;
  gpa_sample_size: number | null;
  num_ratings: number | null;
  would_take_again_pct: number | null;
  top_tags: string | string[] | null;
  department: string | null;
}>;

export interface Meeting {
  id: number;
  section_id: string;
  meeting_index: number;
  type_code: string | null;
  type_name: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  building_name: string | null;
  room_number: string | null;
  date_range_text: string | null;
}

export interface CourseGened {
  id: number;
  course_id: string;
  category_id: string;
  category_name: string | null;
  attribute_code: string;
  attribute_name: string | null;
}

export interface Course {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  credit_hours: number | null;
  year: number;
  term: string;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
  primary_instructor: string | null;
  primary_instructor_rmp: number | null;
  difficulty_score: number | null;
  quality_score: number | null;
  subject_id: string | null;
  course_info: string | null;
  degree_attributes: string | null;
  class_schedule_info: string | null;
  date_range_text: string | null;
  registration_notes: string | null;
  approval_code: string | null;
  last_synced: number | null;
  created_at: number;
  updated_at: number;
}

export interface Section {
  id: string;
  crn: string;
  course_id: string;
  term_id: string;
  section_number: string | null;
  status: string | null;
  type: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  instructor: string | null;
  instructor_rmp: number | null;
  instructor_gpa: number | null;
  last_synced: number | null;
  section_title: string | null;
  status_code: string | null;
  section_status_code: string | null;
  section_text: string | null;
  section_notes: string | null;
  capp_area: string | null;
  date_range_text: string | null;
  part_of_term: string | null;
  start_date: string | null;
  end_date: string | null;
  credit_hours: string | null;
}

export interface TermState {
  term_id: string;
  year: number;
  term: string;
  status: TermStateStatus;
  last_checked: number | null;
  last_synced: number | null;
  subjects_count: number | null;
  courses_count: number | null;
  sections_count: number | null;
  sync_errors: string | null;
  created_at: number;
  updated_at: number;
}

export interface SyncState {
  id: string;
  last_sync: number | null;
  last_status: SyncRunStatus | null;
  items_synced: number | null;
  cursor: number | null;
  etag: string | null;
}

export interface SubjectSyncState {
  term_id: string;
  subject: string;
  last_sync: number | null;
  status: SyncRunStatus;
  courses_synced: number;
  sections_synced: number;
  error: string | null;
}
