import type { D1Database } from '@cloudflare/workers-types';

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

interface RmpTeacherNode {
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

/**
 * Normalizes instructor name to "Last, F" format used in our DB.
 */
function normalizeRmpName(first: string, last: string): string {
  const f = first.trim().charAt(0);
  const l = last.trim();
  return `${l}, ${f}`;
}

/**
 * Fetches all professors from RMP and updates the local cache.
 */
export async function syncRateMyProfessorData(db: D1Database): Promise<{ count: number; message: string }> {
  console.log('[RMP Sync] Starting sync...');

  let hasNextPage = true;
  let cursor: string | null = null;
  let totalSynced = 0;

  // RMP has ~5000 professors. Fetching in chunks of 1000 is safe.
  // We'll process each page immediately to avoid holding everything in memory.

  while (hasNextPage) {
    console.log(`[RMP Sync] Fetching page... (Cursor: ${cursor ? 'yes' : 'start'})`);

    const response = await fetch(RMP_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Authorization': RMP_AUTH_TOKEN,
        'Content-Type': 'application/json',
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
      console.error('[RMP Sync] GraphQL Errors:', json.errors);
      throw new Error('GraphQL query returned errors');
    }

    const { edges, pageInfo } = json.data.newSearch.teachers;

    if (edges.length === 0) {
      break;
    }

    // Process and upsert this batch
    const statements = edges.map(({ node }) => {
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

    // D1 batch limit is often 100 statements. We fetched 1000.
    // We need to chunk the SQL execution.
    const CHUNK_SIZE = 50;
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      const batch = statements.slice(i, i + CHUNK_SIZE);
      await db.batch(batch);
    }

    totalSynced += edges.length;
    console.log(`[RMP Sync] Synced ${totalSynced} professors so far.`);

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    // Polite backoff to avoid rate limits
    if (hasNextPage) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // After syncing the cache, we need to propagate these ratings to the main instructors table
  console.log('[RMP Sync] Propagating ratings to instructors table...');
  await db.prepare(`
    UPDATE instructors
    SET
      rmp_rating = (SELECT rating FROM rmp_cache WHERE instructor_name = instructors.display_name),
      rmp_difficulty = (SELECT difficulty FROM rmp_cache WHERE instructor_name = instructors.display_name)
    WHERE EXISTS (SELECT 1 FROM rmp_cache WHERE instructor_name = instructors.display_name)
  `).run();

  // Also propagate to the courses table? No, courses table holds aggregations.
  // The 'primary_instructor_rmp' field on courses can be updated.
  // This query updates the primary_instructor_rmp on the courses table
  console.log('[RMP Sync] Propagating ratings to courses table...');
  await db.prepare(`
    UPDATE courses
    SET primary_instructor_rmp = (
      SELECT rating
      FROM rmp_cache
      WHERE instructor_name = courses.primary_instructor
    )
    WHERE primary_instructor IS NOT NULL
  `).run();

  console.log(`[RMP Sync] Finished. Total synced: ${totalSynced}`);
  return { count: totalSynced, message: `Synced ${totalSynced} professors.` };
}
