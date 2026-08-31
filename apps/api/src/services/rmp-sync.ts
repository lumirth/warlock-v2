import type { D1Database } from '@cloudflare/workers-types';

const URL = 'https://www.ratemyprofessors.com/graphql';
const SCHOOL_ID = 'U2Nob29sLTExMTI=';
const QUERY = `query($cursor:String){newSearch{teachers(query:{text:"",schoolID:"${SCHOOL_ID}",fallback:true},first:1000,after:$cursor){edges{node{id firstName lastName avgRating numRatings avgDifficulty wouldTakeAgainPercent}}pageInfo{hasNextPage endCursor}}}}`;

export type RmpTeacherNode = {
  id: string;
  firstName: string;
  lastName: string;
  avgRating: number;
  numRatings: number;
  avgDifficulty: number;
  wouldTakeAgainPercent: number;
};
type Page = {
  data?: {
    newSearch?: {
      teachers?: {
        edges: Array<{ node: RmpTeacherNode }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };
  errors?: unknown[];
};

export async function coordinateRmpSync(
  db: D1Database,
  authToken: string | undefined,
): Promise<{ count: number; pages: number }> {
  if (!authToken) throw new Error('RMP_AUTH_TOKEN is required');
  const owner = await claimRun(db);
  if (!owner) throw new Error('RMP sync is already running');
  let count = 0;
  let pages = 0;
  let cursor: string | null = null;
  try {
    do {
      const page = await fetchPage(cursor, authToken);
      await renewRun(db, owner);
      await processRmpBatch(db, page.teachers);
      count += page.teachers.length;
      pages += 1;
      cursor = page.next;
      await writeState(db, owner, 'running', count, pages);
    } while (cursor);
    await writeState(db, owner, 'complete', count, pages);
    return { count, pages };
  } catch (error) {
    await writeState(db, owner, 'failed', count, pages);
    throw error;
  }
}

async function fetchPage(
  cursor: string | null,
  authToken: string,
): Promise<{ teachers: RmpTeacherNode[]; next: string | null }> {
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: authToken,
      'Content-Type': 'application/json',
      'User-Agent': 'UIUC-Course-Search/1.0',
    },
    body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`RMP returned HTTP ${response.status}`);
  const body = await response.json() as Page;
  const teachers = body.data?.newSearch?.teachers;
  if (body.errors?.length || !teachers) throw new Error('RMP returned an invalid GraphQL response');
  return {
    teachers: teachers.edges.map(edge => edge.node),
    next: teachers.pageInfo.hasNextPage ? teachers.pageInfo.endCursor : null,
  };
}

export async function processRmpBatch(db: D1Database, teachers: RmpTeacherNode[]): Promise<void> {
  const rows = teachers.map(teacher => [
    name(teacher), teacher.firstName.trim(), teacher.lastName.trim(), teacher.id,
    teacher.avgRating, teacher.avgDifficulty, teacher.wouldTakeAgainPercent,
    teacher.numRatings,
  ]);
  await db.prepare(`
    INSERT INTO rmp_cache (
      instructor_name, first_name, last_name, rmp_id, rating, difficulty,
      would_take_again_pct, num_ratings, expires_at
    )
    SELECT
      json_extract(value, '$[0]'), json_extract(value, '$[1]'),
      json_extract(value, '$[2]'), json_extract(value, '$[3]'),
      json_extract(value, '$[4]'), json_extract(value, '$[5]'),
      json_extract(value, '$[6]'), json_extract(value, '$[7]'),
      unixepoch() + 604800
    FROM json_each(?) WHERE true
    ON CONFLICT(rmp_id) DO UPDATE SET
      instructor_name = excluded.instructor_name, first_name = excluded.first_name,
      last_name = excluded.last_name, rating = excluded.rating,
      difficulty = excluded.difficulty, would_take_again_pct = excluded.would_take_again_pct,
      num_ratings = excluded.num_ratings, expires_at = excluded.expires_at
  `).bind(JSON.stringify(rows)).run();
}

async function claimRun(db: D1Database): Promise<string | null> {
  const owner = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, owner_token)
    VALUES ('rmp', unixepoch(), 'running', 0, 0, ?)
    ON CONFLICT(id) DO UPDATE SET last_sync = unixepoch(), last_status = 'running',
      items_synced = 0, cursor = 0, owner_token = excluded.owner_token
    WHERE sync_state.last_status != 'running' OR sync_state.last_sync <= unixepoch() - 3600
  `).bind(owner).run();
  return (result.meta?.changes ?? 0) === 1 ? owner : null;
}

async function writeState(
  db: D1Database,
  owner: string,
  status: 'running' | 'complete' | 'failed',
  count: number,
  pages: number,
): Promise<void> {
  await db.prepare(`
    UPDATE sync_state SET last_sync = unixepoch(), last_status = ?, items_synced = ?, cursor = ?,
      owner_token = CASE WHEN ? = 'running' THEN owner_token ELSE NULL END
    WHERE id = 'rmp' AND owner_token = ?
  `).bind(status, count, pages, status, owner).run().then(assertOwner);
}

async function renewRun(db: D1Database, owner: string): Promise<void> {
  await db.prepare(`
    UPDATE sync_state SET last_sync = unixepoch()
    WHERE id = 'rmp' AND last_status = 'running' AND owner_token = ?
  `).bind(owner).run().then(assertOwner);
}

function assertOwner(result: D1Result): void {
  if ((result.meta?.changes ?? 0) !== 1) throw new Error('refusing stale RMP write');
}

function name(teacher: RmpTeacherNode): string {
  const first = teacher.firstName.trim();
  const last = teacher.lastName.trim();
  return first ? `${last}, ${first}` : last;
}
