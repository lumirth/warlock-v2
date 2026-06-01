import { mkdirSync, writeFileSync } from 'node:fs';

type SmokeResult = {
  name: string;
  ok: boolean;
  status?: number;
  detail: string;
};

type JsonRecord = Record<string, unknown>;

function requiredEnv(name: string): string {
  const value = process.env[name];
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
  assert: (response: Response, body: JsonRecord | null) => string | null
): Promise<SmokeResult> {
  try {
    const response = await fetch(request);
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

function formatReport(results: SmokeResult[]): string {
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

async function main(): Promise<void> {
  const baseUrl = requiredEnv('STAGING_API_BASE_URL');
  const adminToken = requiredEnv('STAGING_ADMIN_TOKEN');
  const internalToken = requiredEnv('STAGING_INTERNAL_TOKEN');
  const smokeSubject = process.env.STAGING_SMOKE_SUBJECT ?? 'CS';
  const smokeNumber = process.env.STAGING_SMOKE_NUMBER ?? '225';
  const smokeTerm = process.env.STAGING_SMOKE_TERM ?? 'spring';
  const smokeYear = process.env.STAGING_SMOKE_YEAR ?? '2026';

  const results: SmokeResult[] = [];

  results.push(await check(
    'health',
    new Request(endpoint(baseUrl, 'health')),
    (response) => response.status === 200 ? null : `expected 200, got ${response.status}`
  ));

  results.push(await check(
    'search public route',
    new Request(endpoint(baseUrl, 'api/search?q=CS%20225')),
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
    (response) => response.status === 401 ? null : `expected 401, got ${response.status}`
  ));

  results.push(await check(
    'admin accepts staging token',
    new Request(endpoint(baseUrl, 'admin/upstream-backoff-status'), {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    (response) => response.status === 200 ? null : `expected 200, got ${response.status}`
  ));

  results.push(await check(
    'admin sync status accepts staging token',
    new Request(endpoint(baseUrl, 'admin/sync/status'), {
      headers: { Authorization: `Bearer ${adminToken}` },
    }),
    (response, body) => {
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      if (!hasSyncStatusBody(body)) return 'expected sync status arrays';
      return null;
    }
  ));

  results.push(await check(
    'internal rejects missing token',
    new Request(endpoint(baseUrl, 'internal/enrich-batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: [] }),
    }),
    (response) => response.status === 401 ? null : `expected 401, got ${response.status}`
  ));

  results.push(await check(
    'internal accepts staging token',
    new Request(endpoint(baseUrl, 'internal/enrich-batch'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tasks: [] }),
    }),
    (response) => response.status === 400 ? null : `expected authenticated validation 400, got ${response.status}`
  ));

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/staging-smoke-report.md', formatReport(results));
  writeFileSync('artifacts/staging-smoke-results.json', `${JSON.stringify(results, null, 2)}\n`);

  console.log(formatReport(results));

  if (results.some(result => !result.ok)) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
