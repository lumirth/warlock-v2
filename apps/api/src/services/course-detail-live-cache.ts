import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  CourseDetailContext,
  LiveCourseDetailSnapshot,
} from "./course-detail-types.js";

const LIVE_DETAIL_CACHE_VERSION = "v1";
export const LIVE_DETAIL_CACHE_TTL_SECONDS = 5 * 60;

type LiveDetailCacheEnvelope = {
  courseId: string;
  value: LiveCourseDetailSnapshot;
};

export async function getCachedLiveDetailSnapshot(
  kv: KVNamespace | undefined,
  context: CourseDetailContext,
  nowSeconds: number,
): Promise<LiveCourseDetailSnapshot | null> {
  if (!kv) return null;

  const raw = await kv.get(liveDetailCacheKey(context.courseId), "text");
  if (!raw) return null;

  const envelope = JSON.parse(raw) as Partial<LiveDetailCacheEnvelope>;
  const value = envelope.value;
  if (
    envelope.courseId !== context.courseId
    || !value
    || typeof value !== "object"
    || typeof value.fetchedAt !== "number"
    || !value.snapshot
    || value.snapshot.course.id !== context.courseId
    || value.fetchedAt > nowSeconds + 60
    || nowSeconds - value.fetchedAt > LIVE_DETAIL_CACHE_TTL_SECONDS
  ) {
    return null;
  }

  return value;
}

export async function cacheLiveDetailSnapshot(
  kv: KVNamespace | undefined,
  context: CourseDetailContext,
  value: LiveCourseDetailSnapshot,
): Promise<void> {
  if (!kv) return;
  await kv.put(
    liveDetailCacheKey(context.courseId),
    JSON.stringify({
      courseId: context.courseId,
      value,
    } satisfies LiveDetailCacheEnvelope),
    { expirationTtl: LIVE_DETAIL_CACHE_TTL_SECONDS },
  );
}

function liveDetailCacheKey(courseId: string): string {
  return `course-detail:${LIVE_DETAIL_CACHE_VERSION}:${courseId}`;
}
