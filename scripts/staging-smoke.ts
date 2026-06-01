import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type SmokeResult = {
  name: string;
  ok: boolean;
  status?: number;
  detail: string;
};

type JsonRecord = Record<string, unknown>;
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

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function readJson(response: Response): Promise<JsonRecord | null> {
  try {
    const value = await response.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as JsonRecord
      : null;
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

function hasSyncStatusBody(body: JsonRecord | null): boolean {
  return hasArray(body, 'syncStates')
    && hasArray(body, 'termStates')
    && hasArray(body, 'unhealthySyncStates')
    && hasArray(body, 'runningSyncStates');
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
    'course public route',
    new Request(endpoint(
      baseUrl,
      `api/course/${encodeURIComponent(smokeSubject)}/${encodeURIComponent(smokeNumber)}?term=${encodeURIComponent(smokeTerm)}&year=${encodeURIComponent(smokeYear)}`
    )),
    fetcher,
    (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      if (body?.subject !== smokeSubject || body?.number !== smokeNumber) {
        return `expected ${smokeSubject} ${smokeNumber}`;
      }
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

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
