import { parseCourseDetailXml } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromCourseDetail } from '../transforms/course.js';
import { getUpstreamBackoff, type UpstreamBackoff } from './upstream-backoff.js';
import type {
  CourseDetailContext,
  CourseDetailServiceEnv,
  LiveCourseDetailSnapshot,
} from './course-detail-types.js';

export type CourseDetailLiveResult =
  | { state: 'snapshot'; value: LiveCourseDetailSnapshot }
  | { state: 'not_found' }
  | { state: 'parse_error' }
  | { state: 'upstream_error'; status: number; retryable: boolean };

export class CourseDetailLiveSource {
  constructor(
    private readonly env: Pick<CourseDetailServiceEnv, 'CISAPI_BASE' | 'BACKOFF_BASE_MS' | 'BACKOFF_MAX_MS' | 'MAX_RETRIES'>,
    private readonly nowMs: () => number = () => Date.now()
  ) {}

  createUpstreamBackoff(): UpstreamBackoff {
    return getUpstreamBackoff({
      backoffBaseMs: parseInt(this.env.BACKOFF_BASE_MS, 10) || 5000,
      backoffMaxMs: parseInt(this.env.BACKOFF_MAX_MS, 10) || 60000,
      maxRetries: parseInt(this.env.MAX_RETRIES, 10) || 3,
    });
  }

  async fetchSnapshot(
    context: CourseDetailContext,
    upstreamBackoff: UpstreamBackoff
  ): Promise<CourseDetailLiveResult> {
    await upstreamBackoff.waitIfNeeded();

    const response = await browserFetch(this.courseExplorerXmlUrl(context));
    if (!response.ok) {
      return {
        state: 'upstream_error',
        status: response.status,
        retryable: upstreamBackoff.isRateLimited(response.status) || response.status >= 500,
      };
    }

    upstreamBackoff.recordSuccess();

    const xml = await response.text();
    if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
      return { state: 'not_found' };
    }

    const parsed = parseCourseDetailXml(xml);
    if (!parsed) {
      return { state: 'parse_error' };
    }

    const fetchedAt = Math.floor(this.nowMs() / 1000);
    return {
      state: 'snapshot',
      value: {
        fetchedAt,
        snapshot: fromCourseDetail(parsed, context.subject, context.number, context.resolvedTerm.year, context.term, {
          syncTimestamp: fetchedAt,
        }),
      },
    };
  }

  private courseExplorerXmlUrl(context: CourseDetailContext): string {
    return `${this.env.CISAPI_BASE}/schedule/${context.year}/${context.term}/${context.subject}/${context.number}.xml?mode=cascade`;
  }
}
