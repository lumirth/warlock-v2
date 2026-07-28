import type { CourseInstructorDto } from '@uiuc-course-search/query-types';
import type { InstructorLinkReadRow } from '../db/types.js';
import { courseRequirementRowsToDto } from '../transforms/course-requirements.js';
import {
  courseSnapshotToCourseDetailResponseDto,
  toCourseInstructorMap,
  toCourseDetailResponseDto,
  toCourseSectionDtos,
} from '../dto/course.js';
import type {
  CourseDetailContext,
  CourseDetailEnrichment,
  CourseDetailMetadata,
  CourseDetailResponse,
  CourseWithAge,
  LiveCourseDetailSnapshot,
  StoredDetailOptions,
} from './course-detail-types.js';
import { LIVE_DETAIL_CACHE_TTL_SECONDS } from './course-detail-live-cache.js';

export function buildStoredCourseDetailResponse(
  context: CourseDetailContext,
  course: CourseWithAge,
  enrichment: CourseDetailEnrichment,
  options: StoredDetailOptions
): CourseDetailResponse {
  const isStale = options.state === 'stale';
  const instructorMap = toCourseInstructorMap(enrichment.instructorLinkRows);

  return {
    status: 200,
    body: toCourseDetailResponseDto(course, {
      sections: toCourseSectionDtos(enrichment.sections, instructorMap),
      requirements: courseRequirementRowsToDto(enrichment.requirementRows),
      medianGpa: enrichment.medianGpa,
    }, {
      cached: true,
      stale: isStale,
      staleReason: isStale ? options.staleReason : undefined,
      ageSeconds: finiteNonnegativeOrNull(course.age_seconds),
      fetchedAt: finiteNonnegativeOrNull(course.last_synced),
      termStatus: context.resolvedTerm.status,
    }),
    headers: isStale
      ? { 'X-Cache': 'STALE' }
      : {
        'Cache-Control': cacheControl(context),
        'X-Cache': 'HIT',
      },
  };
}

export function buildLiveCourseDetailResponse(
  context: CourseDetailContext,
  liveSnapshot: LiveCourseDetailSnapshot,
  readModel: {
    instructorLinkRows: InstructorLinkReadRow[];
    existingMetadata: CourseDetailMetadata | null;
    medianGpa: number | null;
  },
  options: {
    cacheHit: boolean;
  },
): CourseDetailResponse {
  const { instructorLinkRows, existingMetadata, medianGpa } = readModel;
  const instructorMap = toCourseInstructorMap(instructorLinkRows);

  return {
    status: 200,
    body: courseSnapshotToCourseDetailResponseDto({
      ...liveSnapshot.snapshot,
      course: {
        ...liveSnapshot.snapshot.course,
        avg_gpa: existingMetadata?.avg_gpa ?? firstInstructorMetric(instructorMap, 'avgGpa'),
        gpa_sample_size: existingMetadata?.gpa_sample_size ?? firstInstructorMetric(instructorMap, 'gpaSampleSize'),
        primary_instructor_rmp: existingMetadata?.primary_instructor_rmp ?? firstInstructorMetric(instructorMap, 'rmpRating'),
        quality_score: existingMetadata?.quality_score ?? null,
        difficulty_score: existingMetadata?.difficulty_score ?? null,
      },
    }, {
      instructorMap,
      medianGpa,
    }, {
      cached: options.cacheHit,
      fetchedAt: liveSnapshot.fetchedAt,
      termStatus: context.resolvedTerm.status,
    }),
    headers: {
      'Cache-Control': cacheControl(context),
      'X-Cache': options.cacheHit ? 'LIVE-HIT' : 'MISS',
    },
  };
}

function cacheControl(context: CourseDetailContext): string {
  const browserSeconds = Math.max(0, Math.floor(context.cacheTtlMs / 1000));
  return [
    'public',
    `max-age=${browserSeconds}`,
    `s-maxage=${LIVE_DETAIL_CACHE_TTL_SECONDS}`,
    `stale-while-revalidate=${LIVE_DETAIL_CACHE_TTL_SECONDS}`,
  ].join(', ');
}

function firstInstructorMetric(
  instructorMap: Record<string, CourseInstructorDto>,
  metric: keyof Pick<CourseInstructorDto, 'rmpRating' | 'avgGpa' | 'medianGpa' | 'gpaSampleSize'>
): number | null {
  const instructor = Object.values(instructorMap).find((entry) => typeof entry[metric] === 'number');
  return instructor?.[metric] ?? null;
}

function finiteNonnegativeOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
