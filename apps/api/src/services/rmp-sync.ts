import type {
  AbortSignal as WorkerAbortSignal,
  D1Database,
  Fetcher,
} from '@cloudflare/workers-types';
import { internalAuthHeaders } from '../middleware/auth.js';
import type { SyncRunStatus } from '../db/types.js';
import { getSyncState, upsertSyncState } from '../db/sync-state-repository.js';

const RMP_GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';
const UIUC_SCHOOL_ID = 'U2Nob29sLTExMTI='; // School-1112 (UIUC)
const RMP_SYNC_ID = 'rmp';
const RMP_SYNC_LEASE_ID = 'rmp-sync-lease';
const RUNNING_LOCK_TTL_SECONDS = 60 * 60;
const RMP_PAGE_TIMEOUT_MS = 60_000;
const D1_BATCH_SIZE = 10;

// GraphQL Queries
const TEACHER_SEARCH_QUERY = `
  query NewSearchTeachers($query: TeacherSearchQuery!, $cursor: String) {
    newSearch {
      teachers(query: $query, first: 1000, after: $cursor) {
        edges {
          cursor
          node {
            id
            firstName
            lastName
            avgRating
            numRatings
            avgDifficulty
            department
            wouldTakeAgainPercent
            teacherRatingTags {
              tagName
              tagCount
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        resultCount
      }
    }
  }
`;

export interface RmpTeacherNode {
  id: string;
  firstName: string;
  lastName: string;
  avgRating: number;
  numRatings: number;
  avgDifficulty: number;
  department: string;
  wouldTakeAgainPercent: number;
  teacherRatingTags: { tagName: string; tagCount: number }[];
}

interface RmpResponse {
  data: {
    newSearch: {
      teachers: {
        edges: { cursor: string; node: RmpTeacherNode }[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
        resultCount: number;
      };
    };
  };
  errors?: unknown[];
}

interface CoordinateRmpSyncOptions {
  rmpAuthToken?: string;
  internalToken?: string;
}

interface RmpPageResult {
  teachers: RmpTeacherNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Preserves the full source identity in canonical "Last, First" form. */
function normalizeRmpName(first: string, last: string): string {
  const normalizedFirst = first.trim();
  const normalizedLast = last.trim();
  return normalizedFirst
    ? `${normalizedLast}, ${normalizedFirst}`
    : normalizedLast;
}

/**
 * Fetches a single page of professors from RMP.
 */
async function fetchRmpPage(cursor: string | null, authToken: string): Promise<RmpPageResult> {
  const response = await fetch(RMP_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': authToken,
      'Content-Type': 'application/json',
      'User-Agent': 'UIUC-Course-Search-Bot/1.0 (+https://github.com/lumirth/uiuc-course-search)'
    },
    body: JSON.stringify({
      query: TEACHER_SEARCH_QUERY,
      variables: {
        query: {
          text: "",
          schoolID: UIUC_SCHOOL_ID,
          fallback: true
        },
        cursor: cursor
      }
    }),
    signal: AbortSignal.timeout(RMP_PAGE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`RMP API failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as RmpResponse;

  if (json.errors) {
    throw new Error('GraphQL query returned errors');
  }

  const { edges, pageInfo } = json.data.newSearch.teachers;

  return {
    teachers: edges.map(e => e.node),
    hasNextPage: pageInfo.hasNextPage,
    endCursor: pageInfo.endCursor
  };
}

/**
 * Coordinator function: Fetches all pages serially and dispatches batch workers.
 */
export async function coordinateRmpSync(
  db: D1Database,
  selfBinding: Fetcher,
  options: CoordinateRmpSyncOptions = {}
): Promise<{ count: number; pages: number }> {
  if (!options.rmpAuthToken) {
    throw new Error('RMP_AUTH_TOKEN binding is required to run RMP sync.');
  }

  const leaseOwner = await claimRmpSyncLease(db);
  if (!leaseOwner) {
    throw new Error('RMP sync is already running.');
  }

  let started = false;
  try {
    const now = Math.floor(Date.now() / 1000);
    const previous = await getSyncState(db, RMP_SYNC_ID);

    // During rollout, an old worker may have set the legacy state row without
    // owning the new lease. Respect a fresh legacy run rather than overlapping
    // it; crashed runs become resumable after the same bounded TTL.
    if (
      previous?.last_status === 'running'
      && previous.last_sync
      && now - previous.last_sync < RUNNING_LOCK_TTL_SECONDS
    ) {
      throw new Error('RMP sync is already running.');
    }

    const shouldResume = previous?.last_status === 'failed' || previous?.last_status === 'running';

    let hasNextPage = true;
    let cursor = shouldResume ? previous?.etag ?? null : null;
    let totalSynced = shouldResume ? previous?.items_synced ?? 0 : 0;
    let pageCount = shouldResume ? previous?.cursor ?? 0 : 0;

    await renewRmpSyncLease(db, leaseOwner);
    await updateRmpSyncState(db, {
      status: 'running',
      totalSynced,
      pageCount,
      cursor,
    });
    started = true;

    while (hasNextPage) {
      await renewRmpSyncLease(db, leaseOwner);
      const result = await fetchRmpPage(cursor, options.rmpAuthToken);
      pageCount++;
      totalSynced += result.teachers.length;

      if (result.teachers.length > 0) {
        await renewRmpSyncLease(db, leaseOwner);
        const dispatch = await selfBinding.fetch('http://internal/internal/sync-rmp-batch', {
          method: 'POST',
          body: JSON.stringify({ teachers: result.teachers }),
          headers: {
            'Content-Type': 'application/json',
            ...internalAuthHeaders(options.internalToken),
          },
          signal: AbortSignal.timeout(RMP_PAGE_TIMEOUT_MS) as unknown as WorkerAbortSignal,
        });

        if (!dispatch.ok) {
          throw new Error(`Failed to dispatch RMP batch ${pageCount}: ${dispatch.status}`);
        }
      }

      hasNextPage = result.hasNextPage;
      cursor = result.endCursor;

      await renewRmpSyncLease(db, leaseOwner);
      await updateRmpSyncState(db, {
        status: hasNextPage ? 'running' : 'complete',
        totalSynced,
        pageCount,
        cursor,
      });

      if (hasNextPage) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return { count: totalSynced, pages: pageCount };
  } catch (error) {
    if (started) {
      try {
        await renewRmpSyncLease(db, leaseOwner);
        const state = await getSyncState(db, RMP_SYNC_ID);
        await updateRmpSyncState(db, {
          status: 'failed',
          totalSynced: state?.items_synced ?? 0,
          pageCount: state?.cursor ?? 0,
          cursor: state?.etag ?? null,
        });
      } catch (leaseError) {
        throw new Error(
          'RMP sync lease ownership changed; refusing stale failure checkpoint',
          { cause: leaseError },
        );
      }
    }
    throw error;
  } finally {
    await releaseRmpSyncLease(db, leaseOwner);
  }
}

async function claimRmpSyncLease(db: D1Database): Promise<string | null> {
  const owner = `rmp:${crypto.randomUUID()}`;
  const staleBefore = Math.floor(Date.now() / 1000) - RUNNING_LOCK_TTL_SECONDS;
  const result = await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), 'running', 0, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
    WHERE sync_state.last_status != 'running'
       OR sync_state.last_sync IS NULL
       OR sync_state.last_sync <= ?
  `).bind(RMP_SYNC_LEASE_ID, owner, staleBefore).run();
  return changedRows(result) === 1 ? owner : null;
}

async function renewRmpSyncLease(db: D1Database, owner: string): Promise<void> {
  const result = await db.prepare(`
    UPDATE sync_state
    SET last_sync = unixepoch()
    WHERE id = ? AND etag = ? AND last_status = 'running'
  `).bind(RMP_SYNC_LEASE_ID, owner).run();
  if (changedRows(result) !== 1) {
    throw new Error('RMP sync lease ownership changed; refusing stale page publication');
  }
}

async function releaseRmpSyncLease(db: D1Database, owner: string): Promise<void> {
  await db.prepare(`
    UPDATE sync_state
    SET last_sync = unixepoch(), last_status = 'complete'
    WHERE id = ? AND etag = ? AND last_status = 'running'
  `).bind(RMP_SYNC_LEASE_ID, owner).run();
}

function changedRows(result: D1Result<unknown>): number {
  return typeof result.meta?.changes === 'number' ? result.meta.changes : 0;
}

async function updateRmpSyncState(
  db: D1Database,
  state: { status: SyncRunStatus; totalSynced: number; pageCount: number; cursor: string | null }
): Promise<void> {
  await upsertSyncState(db, {
    id: RMP_SYNC_ID,
    last_sync: Math.floor(Date.now() / 1000),
    last_status: state.status,
    items_synced: state.totalSynced,
    cursor: state.pageCount,
    etag: state.cursor,
  });
}

/**
 * Batch Worker: Processes a chunk of teachers and updates the database.
 */
export async function processRmpBatch(db: D1Database, teachers: RmpTeacherNode[]): Promise<void> {
  if (teachers.length === 0) return;

  const statements = teachers.map(node => {
    const normalizedName = normalizeRmpName(node.firstName, node.lastName);
    const topTags = [...node.teacherRatingTags]
      .sort((a, b) => b.tagCount - a.tagCount)
      .slice(0, 5)
      .map(t => t.tagName);

    return db.prepare(`
      INSERT INTO rmp_cache (
        instructor_name,
        first_name,
        last_name,
        rmp_id,
        rating,
        difficulty,
        would_take_again_pct,
        num_ratings,
        department,
        top_tags,
        fetched_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch() + 604800) -- 1 week expiry
      ON CONFLICT(rmp_id) DO UPDATE SET
        instructor_name = excluded.instructor_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        rating = excluded.rating,
        difficulty = excluded.difficulty,
        would_take_again_pct = excluded.would_take_again_pct,
        num_ratings = excluded.num_ratings,
        department = excluded.department,
        top_tags = excluded.top_tags,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `).bind(
      normalizedName,
      node.firstName.trim(),
      node.lastName.trim(),
      node.id,
      node.avgRating,
      node.avgDifficulty,
      node.wouldTakeAgainPercent,
      node.numRatings,
      node.department,
      JSON.stringify(topTags)
    );
  });

  for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
    const batch = statements.slice(i, i + D1_BATCH_SIZE);
    await db.batch(batch);
  }
}
