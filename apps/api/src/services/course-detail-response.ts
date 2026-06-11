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
      cached: !isStale,
      stale: isStale,
      staleReason: isStale ? options.staleReason : undefined,
      ageSeconds: course.age_seconds,
      termStatus: context.resolvedTerm.status,
    }),
    headers: isStale
      ? { 'X-Cache': 'STALE' }
      : {
        'Cache-Control': `max-age=${Math.floor(context.cacheTtlMs / 1000)}`,
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
  }
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
      cached: false,
      fetchedAt: liveSnapshot.fetchedAt,
      termStatus: context.resolvedTerm.status,
    }),
    headers: {
      'Cache-Control': `max-age=${Math.floor(context.cacheTtlMs / 1000)}`,
      'X-Cache': 'MISS',
    },
  };
}

function firstInstructorMetric(
  instructorMap: Record<string, CourseInstructorDto>,
  metric: keyof Pick<CourseInstructorDto, 'rmpRating' | 'avgGpa' | 'medianGpa' | 'gpaSampleSize'>
): number | null {
  const instructor = Object.values(instructorMap).find((entry) => typeof entry[metric] === 'number');
  return instructor?.[metric] ?? null;
}
