import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { internalAuthHeaders } from '../middleware/auth.js';
import type { SyncRunStatus } from '../db/types.js';
import { getSyncState, upsertSyncState } from '../db/sync-state-repository.js';

const RMP_GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';
const UIUC_SCHOOL_ID = 'U2Nob29sLTExMTI='; // School-1112 (UIUC)
const RMP_SYNC_ID = 'rmp';
const RUNNING_LOCK_TTL_SECONDS = 60 * 60;
const D1_BATCH_SIZE = 10;
const RMP_PROPAGATION_BATCH_SIZE = 50;

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

/**
 * Normalizes instructor name to "Last, F" format used in our DB.
 */
function normalizeRmpName(first: string, last: string): string {
  const f = first.trim().charAt(0);
  const l = last.trim();
  return `${l}, ${f}`;
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
      'User-Agent': 'UIUC-Course-Search-Bot/1.0 (+https://github.com/magical-course-search)'
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
    })
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

  const now = Math.floor(Date.now() / 1000);
  const previous = await getSyncState(db, RMP_SYNC_ID);

  if (previous?.last_status === 'running' && previous.last_sync && now - previous.last_sync < RUNNING_LOCK_TTL_SECONDS) {
    throw new Error('RMP sync is already running.');
  }

  const shouldResume = previous?.last_status === 'failed' || previous?.last_status === 'running';

  let hasNextPage = true;
  let cursor = shouldResume ? previous?.etag ?? null : null;
  let totalSynced = shouldResume ? previous?.items_synced ?? 0 : 0;
  let pageCount = shouldResume ? previous?.cursor ?? 0 : 0;

  await updateRmpSyncState(db, {
    status: 'running',
    totalSynced,
    pageCount,
    cursor,
  });

  try {
    while (hasNextPage) {
      const result = await fetchRmpPage(cursor, options.rmpAuthToken);
      pageCount++;
      totalSynced += result.teachers.length;

      if (result.teachers.length > 0) {
        const dispatch = await selfBinding.fetch('http://internal/internal/sync-rmp-batch', {
          method: 'POST',
          body: JSON.stringify({ teachers: result.teachers }),
          headers: {
            'Content-Type': 'application/json',
            ...internalAuthHeaders(options.internalToken),
          }
        });

        if (!dispatch.ok) {
          throw new Error(`Failed to dispatch RMP batch ${pageCount}: ${dispatch.status}`);
        }
      }

      hasNextPage = result.hasNextPage;
      cursor = result.endCursor;

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
    await updateRmpSyncState(db, {
      status: 'failed',
      totalSynced,
      pageCount,
      cursor,
    });
    throw error;
  }
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
        rmp_id,
        rating,
        difficulty,
        would_take_again_pct,
        num_ratings,
        department,
        top_tags,
        fetched_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch() + 604800) -- 1 week expiry
      ON CONFLICT(instructor_name) DO UPDATE SET
        rmp_id = excluded.rmp_id,
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

  const instructorNames = teachers.map(node => normalizeRmpName(node.firstName, node.lastName));
  for (let i = 0; i < instructorNames.length; i += RMP_PROPAGATION_BATCH_SIZE) {
    await propagateRmpBatch(db, instructorNames.slice(i, i + RMP_PROPAGATION_BATCH_SIZE));
  }
}

async function propagateRmpBatch(db: D1Database, instructorNames: string[]): Promise<void> {
  const placeholders = instructorNames.map(() => '?').join(', ');

  await db.prepare(`
    UPDATE instructors
    SET
      rmp_rating = (SELECT rating FROM rmp_cache WHERE instructor_name = instructors.display_name),
      rmp_difficulty = (SELECT difficulty FROM rmp_cache WHERE instructor_name = instructors.display_name),
      rmp_num_ratings = (SELECT num_ratings FROM rmp_cache WHERE instructor_name = instructors.display_name)
    WHERE display_name IN (${placeholders})
  `).bind(...instructorNames).run();

  await db.prepare(`
    UPDATE courses
    SET primary_instructor_rmp = (
      SELECT rating
      FROM rmp_cache
      WHERE instructor_name = courses.primary_instructor
    )
    WHERE primary_instructor IN (${placeholders})
  `).bind(...instructorNames).run();
}
