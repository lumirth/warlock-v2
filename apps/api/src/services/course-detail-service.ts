import { errorFields, logger } from '../observability/logger.js';
import { createCourseDetailContext } from './course-detail-context.js';
import { CourseDetailLiveSource } from './course-detail-live-source.js';
import { CourseDetailRepository } from './course-detail-repository.js';
import {
  buildLiveCourseDetailResponse,
  buildStoredCourseDetailResponse,
} from './course-detail-response.js';
import type {
  CourseDetailContext,
  CourseDetailRequest,
  CourseDetailResponse,
  CourseDetailServiceEnv,
  StaleFallbackOptions,
  StoredDetailOptions,
} from './course-detail-types.js';
import type { UpstreamBackoff } from './upstream-backoff.js';

export type {
  CourseDetailRequest,
  CourseDetailResponse,
  CourseDetailServiceEnv,
} from './course-detail-types.js';

export class CourseDetailService {
  constructor(
    private readonly env: CourseDetailServiceEnv,
    private readonly nowMs: () => number = () => Date.now(),
    private readonly repository = new CourseDetailRepository(env.DB),
    private readonly liveSource = new CourseDetailLiveSource(env, nowMs)
  ) {}

  async loadCourseDetail(request: CourseDetailRequest): Promise<CourseDetailResponse> {
    let context: CourseDetailContext | null = null;

    try {
      context = await createCourseDetailContext(this.env, request);

      if (!request.bypassCache) {
        const cached = await this.loadStoredDetail(context, { state: 'cached' });
        if (cached) {
          return cached;
        }
      }

      const upstreamBackoff = this.liveSource.createUpstreamBackoff();
      const backoffState = upstreamBackoff.getState();
      if (backoffState.isBackingOff) {
        const stale = await this.staleFallback(context, {
          staleReason: upstreamBackoff.getErrorMessage(),
          staleHeaderReason: 'rate-limited',
        });
        if (stale) return stale;

        return {
          status: 503,
          body: {
            error: 'Rate limited and no cached data available',
            retryAfter: backoffState.backoffUntil
              ? Math.ceil((backoffState.backoffUntil - this.nowMs()) / 1000)
              : null,
          },
        };
      }

      return await this.loadLiveSnapshot(context, upstreamBackoff);
    } catch (error) {
      logger.error('service.courseDetail.failed', {
        subject: context?.subject ?? request.subject,
        number: context?.number ?? request.number,
        termId: context?.termId,
        ...errorFields(error),
      });
      return { status: 500, body: { error: 'Internal server error' } };
    }
  }

  private async loadStoredDetail(
    context: CourseDetailContext,
    options: StoredDetailOptions
  ): Promise<CourseDetailResponse | null> {
    const existing = await this.repository.loadStoredCourse(context.courseId);
    if (!existing) return null;

    if (options.state === 'cached' && existing.age_seconds * 1000 >= context.cacheTtlMs) {
      return null;
    }

    const enrichment = await this.repository.loadEnrichment(context);
    return buildStoredCourseDetailResponse(context, existing, enrichment, options);
  }

  private async loadLiveSnapshot(
    context: CourseDetailContext,
    upstreamBackoff: UpstreamBackoff
  ): Promise<CourseDetailResponse> {
    const liveResult = await this.liveSource.fetchSnapshot(context, upstreamBackoff);

    switch (liveResult.state) {
      case 'snapshot': {
        const [linksMap, existingMetadata, medianGpa] = await Promise.all([
          this.repository.loadInstructorLinks(context),
          this.repository.loadExistingCourseMetadata(context.courseId),
          this.repository.loadCourseMedianGpa(context.subject, context.number),
        ]);

        return buildLiveCourseDetailResponse(context, liveResult.value, {
          linksMap,
          existingMetadata,
          medianGpa,
        });
      }
      case 'not_found':
        return { status: 404, body: { error: 'Course not found' } };
      case 'parse_error':
        return { status: 500, body: { error: 'Failed to parse course data' } };
      case 'upstream_error':
        return this.handleUnsuccessfulUpstream(
          context,
          upstreamBackoff,
          liveResult.status,
          liveResult.retryable
        );
    }
  }

  private async staleFallback(
    context: CourseDetailContext,
    options: StaleFallbackOptions
  ): Promise<CourseDetailResponse | null> {
    const stale = await this.loadStoredDetail(context, {
      state: 'stale',
      staleReason: options.staleReason,
    });
    if (!stale) return null;

    return {
      ...stale,
      headers: {
        ...stale.headers,
        'X-Stale-Reason': options.staleHeaderReason,
      },
    };
  }

  private async handleUnsuccessfulUpstream(
    context: CourseDetailContext,
    upstreamBackoff: UpstreamBackoff,
    status: number,
    retryable: boolean
  ): Promise<CourseDetailResponse> {
    if (retryable) {
      upstreamBackoff.recordFailure(`${context.subject} ${context.number}: ${status}`, status);
      const stale = await this.staleFallback(context, {
        staleReason: `upstream returned ${status}`,
        staleHeaderReason: 'upstream-unavailable',
      });
      if (stale) return stale;

      return {
        status: status === 429 || status === 503 ? 503 : 502,
        body: {
          error: 'Upstream course data unavailable',
          upstreamStatus: status,
        },
      };
    }

    if (status === 404) {
      return { status: 404, body: { error: 'Course not found' } };
    }

    return {
      status: 502,
      body: {
        error: 'Upstream course data unavailable',
        upstreamStatus: status,
      },
    };
  }
}
