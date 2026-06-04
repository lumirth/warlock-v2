import type { InstructorLinkDto } from '@uiuc-course-search/query-types';
import { courseSnapshotToCourseDto, toCourseDto } from '../dto/course.js';
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

  return {
    status: 200,
    body: toCourseDto(course, {
      sections: enrichment.enrichedSections,
      instructorLinks: enrichment.linksMap,
      geneds: enrichment.geneds,
      medianGpa: enrichment.medianGpa,
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
    linksMap: Record<string, InstructorLinkDto>;
    existingMetadata: CourseDetailMetadata | null;
    medianGpa: number | null;
  }
): CourseDetailResponse {
  const { linksMap, existingMetadata, medianGpa } = readModel;

  return {
    status: 200,
    body: courseSnapshotToCourseDto({
      ...liveSnapshot.snapshot,
      course: {
        ...liveSnapshot.snapshot.course,
        avg_gpa: existingMetadata?.avg_gpa ?? firstInstructorMetric(linksMap, 'avg_gpa'),
        gpa_sample_size: existingMetadata?.gpa_sample_size ?? firstInstructorMetric(linksMap, 'gpa_sample_size'),
        primary_instructor_rmp: existingMetadata?.primary_instructor_rmp ?? firstInstructorMetric(linksMap, 'rmp_rating'),
        quality_score: existingMetadata?.quality_score ?? null,
        difficulty_score: existingMetadata?.difficulty_score ?? null,
      },
    }, {
      instructorLinks: linksMap,
      medianGpa,
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
  linksMap: Record<string, InstructorLinkDto>,
  metric: keyof Pick<InstructorLinkDto, 'rmp_rating' | 'avg_gpa' | 'median_gpa' | 'gpa_sample_size'>
): number | null {
  const link = Object.values(linksMap).find((entry) => typeof entry[metric] === 'number');
  return link?.[metric] ?? null;
}
