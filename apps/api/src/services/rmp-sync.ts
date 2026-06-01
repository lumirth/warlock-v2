import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { internalAuthHeaders } from '../middleware/auth.js';

const RMP_GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';
const UIUC_SCHOOL_ID = 'U2Nob29sLTExMTI='; // School-1112 (UIUC)
const RMP_SYNC_ID = 'rmp';
const RUNNING_LOCK_TTL_SECONDS = 60 * 60;

// GraphQL Queries
const TEACHER_SEARCH_QUERY = `
  query NewSearchTeachers($query: TeacherSearchQuery!, $cursor: String) {
    newSearch {
      teachers(query: $query, first: 1000, after: $cursor) {
        edges {
          cursor
          node {
            id
            legacyId
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
  legacyId: number;
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

interface RmpSyncState {
  last_sync: number | null;
  last_status: string | null;
  items_synced: number | null;
  cursor: number | null;
  etag: string | null;
}

export interface CoordinateRmpSyncOptions {
  rmpAuthToken?: string;
  internalToken?: string;
}

export interface RmpPageResult {
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
export async function fetchRmpPage(cursor: string | null, authToken: string): Promise<RmpPageResult> {
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
  const previous = await db.prepare(`
    SELECT last_sync, last_status, items_synced, cursor, etag
    FROM sync_state
    WHERE id = ?
  `).bind(RMP_SYNC_ID).first<RmpSyncState>();

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
  state: { status: string; totalSynced: number; pageCount: number; cursor: string | null }
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(RMP_SYNC_ID, state.status, state.totalSynced, state.pageCount, state.cursor).run();
}

/**
 * Batch Worker: Processes a chunk of teachers and updates the database.
 */
export async function processRmpBatch(db: D1Database, teachers: RmpTeacherNode[]): Promise<void> {
  if (teachers.length === 0) return;

  // 1. Prepare statements for rmp_cache
  const statements = teachers.map(node => {
    const normalizedName = normalizeRmpName(node.firstName, node.lastName);
    const topTags = node.teacherRatingTags
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

  // 2. Execute in chunks (D1 limit)
  const CHUNK_SIZE = 10; // Conservative limit due to parameter count (8 params * 10 rows = 80 params < 100 limit)
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const batch = statements.slice(i, i + CHUNK_SIZE);
    await db.batch(batch);
  }

  // 3. Propagate to main tables (Optimization: Only for these specific teachers)
  // We can do this efficiently by only updating records where the name matches the batch
  // We can't bind thousands of names, so we'll do a general update for now
  // Or better, we can just run the general update queries which are fast enough on indexed columns
  // For simplicity and correctness, we'll run the propagation queries.
  // In a high-scale system, we'd batch these by ID too, but for 1000 records, the subquery match is fine.

  // NOTE: Running this 5 times (once per batch) is redundant but safe.
  // Alternatively, we could have a "Finalize" step, but that requires coordination.
  // Let's keep it self-contained in the batch worker.

  await db.prepare(`
    UPDATE instructors
    SET
      rmp_rating = (SELECT rating FROM rmp_cache WHERE instructor_name = instructors.display_name),
      rmp_difficulty = (SELECT difficulty FROM rmp_cache WHERE instructor_name = instructors.display_name),
      rmp_num_ratings = (SELECT num_ratings FROM rmp_cache WHERE instructor_name = instructors.display_name)
    WHERE display_name IN (SELECT instructor_name FROM rmp_cache WHERE fetched_at > unixepoch() - 300)
    AND EXISTS (SELECT 1 FROM rmp_cache WHERE instructor_name = instructors.display_name)
  `).run();

  // Same for courses
  await db.prepare(`
    UPDATE courses
    SET primary_instructor_rmp = (
      SELECT rating
      FROM rmp_cache
      WHERE instructor_name = courses.primary_instructor
    )
    WHERE primary_instructor IN (SELECT instructor_name FROM rmp_cache WHERE fetched_at > unixepoch() - 300)
  `).run();

}

export async function syncRateMyProfessorData(_db: D1Database): Promise<{ count: number; message: string }> {
  throw new Error("Use coordinateRmpSync or processRmpBatch instead.");
}
