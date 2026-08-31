import { runCli } from './lib/run-cli.ts';

type Json = Record<string, unknown>;
type Check = {
  name: string;
  request: Request;
  expectedStatus: number;
  validate?: (body: Json) => boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Json
    : {};
}

function hasArrays(body: Json, names: string[]): boolean {
  return names.every(name => Array.isArray(body[name]));
}

async function main(): Promise<void> {
  const baseUrl = required('STAGING_API_BASE_URL');
  const adminToken = required('STAGING_ADMIN_TOKEN');
  const webOrigin = required('STAGING_WEB_ORIGIN');
  const subject = process.env.STAGING_SMOKE_SUBJECT ?? 'CS';
  const number = process.env.STAGING_SMOKE_NUMBER ?? '225';
  const term = process.env.STAGING_SMOKE_TERM ?? 'fall';
  const year = process.env.STAGING_SMOKE_YEAR ?? '2026';
  const admin = { Authorization: `Bearer ${adminToken}` };

  const checks: Check[] = [
    {
      name: 'health',
      request: new Request(endpoint(baseUrl, 'health')),
      expectedStatus: 200,
    },
    {
      name: 'search contract',
      request: new Request(endpoint(baseUrl, 'api/search?q=CS%20225')),
      expectedStatus: 200,
      validate: body => Array.isArray(body.results),
    },
    {
      name: 'course contract',
      request: new Request(endpoint(baseUrl, `api/course/${subject}/${number}?term=${term}&year=${year}`)),
      expectedStatus: 200,
      validate: body => {
        const course = object(body.course);
        const links = object(course.links);
        return course.subject === subject
          && course.number === number
          && typeof links.courseExplorerUrl === 'string';
      },
    },
    {
      name: 'feedback validation and origin boundary',
      request: new Request(endpoint(baseUrl, 'api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: webOrigin },
        body: '{}',
      }),
      expectedStatus: 400,
    },
    {
      name: 'admin rejects missing token',
      request: new Request(endpoint(baseUrl, 'admin/sync/status')),
      expectedStatus: 401,
    },
    {
      name: 'admin status contract',
      request: new Request(endpoint(baseUrl, 'admin/sync/status'), { headers: admin }),
      expectedStatus: 200,
      validate: body => hasArrays(body, ['terms', 'jobs', 'incompleteSubjects']),
    },
  ];

  const failures = await runChecks(checks);
  if (failures.length > 0) throw new Error(`Staging smoke failed: ${failures.join(', ')}`);
}

async function runChecks(checks: Check[]): Promise<string[]> {
  const failures: string[] = [];
  for (const check of checks) {
    try {
      const response = await fetch(check.request);
      const body = object(await response.json().catch(() => undefined));
      const passed = response.status === check.expectedStatus
        && (!check.validate || check.validate(body));
      console.log(`${passed ? 'PASS' : 'FAIL'} ${check.name}: HTTP ${response.status}`);
      if (!passed) failures.push(check.name);
    } catch (error) {
      console.error(`FAIL ${check.name}: ${error}`);
      failures.push(check.name);
    }
  }
  return failures;
}

runCli(import.meta.url, main);
