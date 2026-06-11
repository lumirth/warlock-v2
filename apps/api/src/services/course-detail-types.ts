import type { D1Database } from '@cloudflare/workers-types';
import type {
  CourseDetailResponseDto,
} from '@uiuc-course-search/query-types';
import type {
  Course,
  CourseGened,
  InstructorLinkReadRow,
  Meeting,
  Section,
} from '../db/types.js';
import type { CourseSnapshot } from '../transforms/course.js';
import type { ResolvedTerm } from './term-state.js';

export type CourseDetailServiceEnv = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CLIENT_CACHE_TTL_MS: string;
};

export type CourseDetailRequest = {
  subject: string;
  number: string;
  requestedYear?: string | null;
  requestedTerm?: string | null;
  bypassCache?: boolean;
};

type CourseDetailErrorBody = {
  error: string;
  retryAfter?: number | null;
  upstreamStatus?: number;
};

export type CourseDetailResponse = {
  status: 200 | 404 | 500 | 502 | 503;
  body: CourseDetailResponseDto | CourseDetailErrorBody;
  headers?: Record<string, string>;
};

export type CourseDetailContext = {
  subject: string;
  number: string;
  resolvedTerm: ResolvedTerm;
  courseId: string;
  cacheTtlMs: number;
};

export type CourseWithAge = Course & {
  age_seconds: number;
};

export type CourseDetailMetadata = Pick<
  Course,
  | 'avg_gpa'
  | 'gpa_sample_size'
  | 'primary_instructor_rmp'
  | 'quality_score'
  | 'difficulty_score'
>;

export type CourseDetailEnrichment = {
  instructorLinkRows: InstructorLinkReadRow[];
  sections: CourseDetailSectionReadModel[];
  medianGpa: number | null;
  requirementRows: CourseGened[];
};

export type CourseDetailSectionReadModel = Section & {
  meetings: Array<Meeting & { instructor_names: string | null }>;
};

export type StoredDetailOptions =
  | { state: 'cached' }
  | { state: 'stale'; staleReason: string | null };

export type StaleFallbackOptions = {
  staleReason: string | null;
  staleHeaderReason: string;
};

export type LiveCourseDetailSnapshot = {
  snapshot: CourseSnapshot;
  fetchedAt: number;
};
