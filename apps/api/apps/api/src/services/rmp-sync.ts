import type { D1Database, Fetcher } from '@cloudflare/workers-types';

const RMP_GRAPHQL_URL = 'https://www.ratemyprofessors.com/graphql';
const RMP_AUTH_TOKEN = 'Basic dGVzdDp0ZXN0'; // Public test token
const UIUC_SCHOOL_ID = 'U2Nob29sLTExMTI='; // School-1112 (UIUC)

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
  errors?: any[];
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
export async function fetchRmpPage(cursor: string | null): Promise<RmpPageResult> {
  console.log(`[RMP Fetch] Requesting page with cursor: ${cursor || 'start'}`);

  const response = await fetch(RMP_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': RMP_AUTH_TOKEN,
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
    console.error('[RMP Fetch] GraphQL Errors:', json.errors);
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
export async function coordinateRmpSync(selfBinding: Fetcher): Promise<{ count: number; pages: number }> {
  console.log('[RMP Coord] Starting sync coordination...');

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalSynced = 0;
  let pageCount = 0;

  while (hasNextPage) {
    // 1. Fetch Page
    const result = await fetchRmpPage(cursor);
    pageCount++;
    totalSynced += result.teachers.length;

    if (result.teachers.length > 0) {
      // 2. Dispatch Batch Worker (Fan-Out)
      console.log(`[RMP Coord] Dispatching batch ${pageCount} with ${result.teachers.length} teachers...`);

      // Fire and forget dispatch via Service Binding
      // We don't await the response body, just the dispatch
      const dispatch = await selfBinding.fetch('http://internal/internal/sync-rmp-batch', {
        method: 'POST',
        body: JSON.stringify({ teachers: result.teachers }),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!dispatch.ok) {
        console.error(`[RMP Coord] Failed to dispatch batch ${pageCount}: ${dispatch.status}`);
      }
    }

    // 3. Prepare next loop
    hasNextPage = result.hasNextPage;
    cursor = result.endCursor;

    // Polite backoff between fetches
    if (hasNextPage) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`[RMP Coord] Coordination complete. Dispatched ${pageCount} batches (${totalSynced} total teachers).`);
  return { count: totalSynced, pages: pageCount };
}

/**
 * Batch Worker: Processes a chunk of teachers and updates the database.
 */
export async function processRmpBatch(db: D1Database, teachers: RmpTeacherNode[]): Promise<void> {
  if (teachers.length === 0) return;

  console.log(`[RMP Batch] Processing ${teachers.length} teachers...`);

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
  const names = teachers.map(t => normalizeRmpName(t.firstName, t.lastName));
  const uniqueNames = [...new Set(names)];

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
      rmp_difficulty = (SELECT difficulty FROM rmp_cache WHERE instructor_name = instructors.display_name)
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

  console.log(`[RMP Batch] Finished processing batch.`);
}

/**
 * Legacy/Dev wrapper for full sync (kept for admin endpoint compatibility)
 */
export async function syncRateMyProfessorData(db: D1Database): Promise<{ count: number; message: string }> {
  // This is now deprecated for production use, but we can shim it if needed.
  // Ideally, the admin endpoint should trigger the coordinator.
  throw new Error("Use coordinateRmpSync or processRmpBatch instead.");
}
