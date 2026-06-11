import { mkdirSync, writeFileSync } from 'node:fs';
import { runCli } from './lib/run-cli.ts';
import { asRecord, type JsonRecord } from './lib/json-shape.ts';
import { endpoint } from './lib/script-args.ts';

export type SmokeResult = {
  name: string;
  ok: boolean;
  status?: number;
  detail: string;
};

export const STAGING_SMOKE_CHECK_NAMES = [
  'health',
  'search public route',
  'professor search route',
  'course public route',
  'feedback public route',
  'admin rejects missing token',
  'admin accepts staging token',
  'admin sync status accepts staging token',
  'internal rejects missing token',
  'internal accepts staging token',
] as const;

type Fetcher = (request: Request) => Promise<Response>;

type StagingSmokeOptions = {
  env?: NodeJS.ProcessEnv;
  fetcher?: Fetcher;
  artifactDir?: string;
  writeArtifacts?: boolean;
  log?: (report: string) => void;
};

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function readJson(response: Response): Promise<JsonRecord | null> {
  try {
    return asRecord(await response.json());
  } catch {
    return null;
  }
}

async function check(
  name: string,
  request: Request,
  fetcher: Fetcher,
  assert: (response: Response, body: JsonRecord | null) => string | null
): Promise<SmokeResult> {
  try {
    const response = await fetcher(request);
    const body = await readJson(response);
    const failure = assert(response, body);
    return {
      name,
      ok: failure === null,
      status: response.status,
      detail: failure ?? 'ok',
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: String(error),
    };
  }
}

function hasArray(body: JsonRecord | null, key: string): boolean {
  return Array.isArray(body?.[key]);
}

function hasCourseExplorerLinks(body: JsonRecord | null): boolean {
  const course = body?.course;
  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    return false;
  }
  const courseRecord = course as JsonRecord;
  const links = courseRecord.links;
  if (!links || typeof links !== 'object' || Array.isArray(links)) {
    return false;
  }
  if (typeof (links as JsonRecord).courseExplorerUrl !== 'string') {
    return false;
  }

  const sections = Array.isArray(courseRecord.sections)
    ? courseRecord.sections as JsonRecord[]
    : [];
  return sections.some((section) => {
    const sectionLinks = section.links;
    return (
      sectionLinks
      && typeof sectionLinks === 'object'
      && !Array.isArray(sectionLinks)
      && typeof (sectionLinks as JsonRecord).courseExplorerUrl === 'string'
    );
  });
}

function hasInstructorEvidence(body: JsonRecord | null): boolean {
  const results = Array.isArray(body?.results) ? body.results as JsonRecord[] : [];
  return results.some((result) => {
    const evidence = Array.isArray(result.matchEvidence)
      ? result.matchEvidence as JsonRecord[]
      : [];
    const hasEvidence = evidence.some(item => item.kind === 'instructor');
    const course = result.course;
    const primaryInstructor = course && typeof course === 'object' && !Array.isArray(course)
      ? (course as JsonRecord).primaryInstructor
      : null;
    return hasEvidence
      && typeof primaryInstructor === 'string'
      && /fagen/i.test(primaryInstructor);
  });
}

function hasSyncStatusBody(body: JsonRecord | null): boolean {
  return hasArray(body, 'syncStates')
    && hasArray(body, 'subjectSyncStates')
    && hasArray(body, 'termStates')
    && hasArray(body, 'unhealthySyncStates')
    && hasArray(body, 'runningSyncStates')
    && hasArray(body, 'unhealthySubjectSyncStates')
    && hasArray(body, 'runningSubjectSyncStates');
}

export function formatReport(results: SmokeResult[]): string {
  const failed = results.filter(result => !result.ok);
  const lines = [
    '# Staging Smoke Report',
    '',
    `Total checks: ${results.length}`,
    `Passing checks: ${results.length - failed.length}`,
    `Failed checks: ${failed.length}`,
    '',
    '## Checks',
    '',
  ];

  for (const result of results) {
    lines.push(`- ${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.status ?? 'no-status'} ${result.detail}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runStagingSmoke(options: StagingSmokeOptions = {}): Promise<SmokeResult[]> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? ((request: Request) => fetch(request));
  const artifactDir = options.artifactDir ?? 'artifacts';
  const writeArtifacts = options.writeArtifacts ?? true;
  const log = options.log ?? ((report: string) => console.log(report));
  const baseUrl = requiredEnv(env, 'STAGING_API_BASE_URL');
  const adminToken = requiredEnv(env, 'STAGING_ADMIN_TOKEN');
  const internalToken = requiredEnv(env, 'STAGING_INTERNAL_TOKEN');
  const smokeSubject = env.STAGING_SMOKE_SUBJECT ?? 'CS';
  const smokeNumber = env.STAGING_SMOKE_NUMBER ?? '225';
  const smokeTerm = env.STAGING_SMOKE_TERM ?? 'spring';
  const smokeYear = env.STAGING_SMOKE_YEAR ?? '2026';
  const smokeRunId = env.STAGING_SMOKE_RUN_ID ?? `staging-smoke-${Date.now()}`;

  const results: SmokeResult[] = [];

  results.push(await check(
    'health',
    new Request(endpoint(baseUrl, 'health')),
    fetcher,
    (response) => response.status === 200 ? null : `expected 200, got ${response.status}`
  ));

  results.push(await check(
    'search public route',
    new Request(endpoint(baseUrl, 'api/search?q=CS%20225')),
    fetcher,
    (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      if (!hasArray(body, 'results')) return 'expected results array';
      return null;
    }
  ));

  results.push(await check(
    'professor search route',
    new Request(endpoint(baseUrl, 'api/search?q=professor%20fagen%20algorithms')),
    fetcher,
    (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      if (!hasArray(body, 'results')) return 'expected results array';
      if (!hasInstructorEvidence(body)) return 'expected public instructor match evidence';
      return null;
    }
  ));

  results.push(await check(
    'course public route',
    new Request(endpoint(
      baseUrl,
      `api/course/${encodeURIComponent(smokeSubject)}/${encodeURIComponent(smokeNumber)}?term=${encodeURIComponent(smokeTerm)}&year=${encodeURIComponent(smokeYear)}&fresh=true`
    ), {
      headers: { 'Cache-Control': 'no-cache' },
    }),
    fetcher,
    (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      const course = body?.course;
      if (!course || typeof course !== 'object' || Array.isArray(course)) {
        return 'expected nested course detail response';
      }
      const courseRecord = course as JsonRecord;
      if (courseRecord.subject !== smokeSubject || courseRecord.number !== smokeNumber) {
        return `expected ${smokeSubject} ${smokeNumber}`;
      }
      if (!hasCourseExplorerLinks(body)) return 'expected course and section Course Explorer links';
      return null;
    }
  ));

  results.push(await check(
    'feedback public route',
    new Request(endpoint(baseUrl, 'api/feedback'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'uiuc-course-search-staging-smoke',
      },
      body: JSON.stringify({
        kind: 'search_results',
        issue: 'expected_different_results',
        page: 'search',
        query: 'professor fagen algorithms',
        expected: 'CS 225 with Wade Fagen-Ulmschneider',
        message: `automated staging smoke ${smokeRunId}`,
        anonymousSessionId: smokeRunId,
        metadata: { smoke: true },
      }),
    }),
    fetcher,
    (response, body) => {
      if (response.status !== 202) return `expected 202, got ${response.status}`;
      if (body?.status !== 'accepted') return 'expected accepted feedback response';
      return null;
    }
  ));

  results.push(await check(
    'admin rejects missing token',
    new Request(endpoint(baseUrl, 'admin/upstream-backoff-status')),
    fetcher,
    (response) => response.status === 401 ? null : `expected 401, got ${response.status}`
  ));

  results.push(await check(
    'admin accepts staging token',
    new Request(endpoint(baseUrl, 'admin/upstream-backoff-status'), {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    fetcher,
    (response) => response.status === 200 ? null : `expected 200, got ${response.status}`
  ));

  results.push(await check(
    'admin sync status accepts staging token',
    new Request(endpoint(baseUrl, 'admin/sync/status'), {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    fetcher,
    (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      if (!hasSyncStatusBody(body)) return 'expected sync status arrays';
      return null;
    }
  ));

  results.push(await check(
    'internal rejects missing token',
    new Request(endpoint(baseUrl, 'internal/sync-batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: Number(smokeYear), term: smokeTerm, subjects: [] }),
    }),
    fetcher,
    (response) => response.status === 401 ? null : `expected 401, got ${response.status}`
  ));

  results.push(await check(
    'internal accepts staging token',
    new Request(endpoint(baseUrl, 'internal/sync-batch'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ year: Number(smokeYear), term: smokeTerm, subjects: [] }),
    }),
    fetcher,
    (response) => response.status === 400 ? null : `expected authenticated validation 400, got ${response.status}`
  ));

  const report = formatReport(results);
  if (writeArtifacts) {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(`${artifactDir}/staging-smoke-report.md`, report);
    writeFileSync(`${artifactDir}/staging-smoke-results.json`, `${JSON.stringify(results, null, 2)}\n`);
  }

  log(report);

  return results;
}

async function main(): Promise<void> {
  const results = await runStagingSmoke();
  if (results.some(result => !result.ok)) {
    process.exitCode = 1;
  }
}

runCli(import.meta.url, main);
