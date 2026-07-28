import { parseCourseDetailXml } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromCourseDetail } from '../transforms/course.js';
import { getUpstreamBackoff, type UpstreamBackoff } from './upstream-backoff.js';
import type {
  CourseDetailContext,
  CourseDetailServiceEnv,
  LiveCourseDetailSnapshot,
} from './course-detail-types.js';

type CourseDetailLiveResult =
  | { state: 'snapshot'; value: LiveCourseDetailSnapshot }
  | { state: 'not_found' }
  | { state: 'upstream_error'; status: number; retryable: boolean };

const COURSE_DETAIL_FETCH_TIMEOUT_MS = 10_000;
const COURSE_DETAIL_MAX_BODY_BYTES = 4 * 1024 * 1024;
const inFlightSnapshots = new Map<string, Promise<CourseDetailLiveResult>>();

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
    const existing = inFlightSnapshots.get(context.courseId);
    if (existing) return existing;

    const request = this.fetchSnapshotOnce(context, upstreamBackoff)
      .finally(() => {
        inFlightSnapshots.delete(context.courseId);
      });
    inFlightSnapshots.set(context.courseId, request);
    return request;
  }

  private async fetchSnapshotOnce(
    context: CourseDetailContext,
    upstreamBackoff: UpstreamBackoff
  ): Promise<CourseDetailLiveResult> {
    await upstreamBackoff.waitIfNeeded();

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(
        `course detail fetch timed out after ${COURSE_DETAIL_FETCH_TIMEOUT_MS}ms`,
      ));
    }, COURSE_DETAIL_FETCH_TIMEOUT_MS);

    try {
      const response = await browserFetch(this.courseExplorerXmlUrl(context), {
        retries: boundedRetries(this.env.MAX_RETRIES),
        timeoutMs: COURSE_DETAIL_FETCH_TIMEOUT_MS,
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          state: 'upstream_error',
          status: response.status,
          retryable: upstreamBackoff.isRateLimited(response.status) || response.status >= 500,
        };
      }

      const xml = await readBoundedResponseText(
        response,
        controller.signal,
        COURSE_DETAIL_MAX_BODY_BYTES,
      );
      if (/<(?:!doctype\s+html|html)\b/i.test(xml)) {
        return {
          state: 'upstream_error',
          status: response.status || 502,
          retryable: true,
        };
      }

      const parsed = parseCourseDetailXml(xml);
      if (!parsed || !matchesRequestedCourse(parsed, context)) {
        return {
          state: 'upstream_error',
          status: 502,
          retryable: true,
        };
      }

      upstreamBackoff.recordSuccess();
      const fetchedAt = Math.floor(this.nowMs() / 1000);
      return {
        state: 'snapshot',
        value: {
          fetchedAt,
          snapshot: fromCourseDetail(parsed, context.subject, context.number, context.resolvedTerm.year, context.resolvedTerm.term, {
            syncTimestamp: fetchedAt,
          }),
        },
      };
    } catch {
      return {
        state: 'upstream_error',
        status: 0,
        retryable: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private courseExplorerXmlUrl(context: CourseDetailContext): string {
    return `${this.env.CISAPI_BASE}/schedule/${context.resolvedTerm.year}/${context.resolvedTerm.term}/${context.subject}/${context.number}.xml?mode=cascade`;
  }
}

function boundedRetries(raw: string): number {
  const configured = Number.parseInt(raw, 10);
  if (!Number.isFinite(configured)) return 2;
  return Math.max(0, Math.min(configured, 3));
}

export function resetCourseDetailInFlightRequests(): void {
  inFlightSnapshots.clear();
}

async function readBoundedResponseText(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let rejectOnAbort: ((error: Error) => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
    rejectOnAbort?.(signal.reason instanceof Error
      ? signal.reason
      : new Error('Course detail response body aborted'));
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel('Course detail response body exceeded byte limit')
          .catch(() => undefined);
        throw new Error(`Course detail response body exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function matchesRequestedCourse(
  parsed: { id: string; subjectId: string },
  context: CourseDetailContext,
): boolean {
  const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalize(parsed.subjectId) === normalize(context.subject)
    && normalize(parsed.id) === normalize(`${context.subject}${context.number}`);
}
