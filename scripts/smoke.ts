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
  const args = process.argv.slice(2);
  const target = args.length === 0 ? 'staging'
    : args.length === 2 && args[0] === '--target' ? args[1] : undefined;
  if (target !== 'staging' && target !== 'production') {
    throw new Error('Usage: smoke.ts [--target staging|production]');
  }
  const prefix = target === 'production' ? 'PRODUCTION' : 'STAGING';
  const baseUrl = process.env[`${prefix}_API_BASE_URL`]
    ?? `https://warlock${target === 'staging' ? '-staging' : ''}.lumirth.workers.dev`;
  const adminToken = required(`${prefix}_ADMIN_TOKEN`);
  const webOrigin = process.env[`${prefix}_WEB_ORIGIN`]
    ?? `https://${target === 'staging' ? 'staging.' : ''}warlock-v2.pages.dev`;
  const subject = process.env.SMOKE_SUBJECT || 'CS';
  const number = process.env.SMOKE_NUMBER || '225';
  const readiness = await fetch(endpoint(baseUrl, '/'), {
    signal: AbortSignal.timeout(30_000),
  });
  const published = object(await readiness.json().catch(() => undefined));
  const offering = typeof published.term === 'string'
    ? /^(winter|spring|summer|fall) (\d{4})$/.exec(published.term) : null;
  if (!readiness.ok || !offering) throw new Error('No populated current catalog term.');
  const term = process.env.SMOKE_TERM || offering[1];
  const year = process.env.SMOKE_YEAR || offering[2];
  const admin = { Authorization: `Bearer ${adminToken}` };

  const checks: Check[] = [
    {
      name: 'health',
      request: new Request(endpoint(baseUrl, 'health')),
      expectedStatus: 200,
    },
    {
      name: 'search contract',
      request: new Request(endpoint(baseUrl, `api/search?q=${encodeURIComponent(`${subject} ${number}`)}&term=${term}&year=${year}`)),
      expectedStatus: 200,
      validate: body => Array.isArray(body.results)
        && body.results.some(value => {
          const result = object(object(value).course);
          return result.subject === subject && result.number === number;
        }),
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
  if (failures.length > 0) throw new Error(`${target} smoke failed: ${failures.join(', ')}`);
}

async function runChecks(checks: Check[]): Promise<string[]> {
  const failures: string[] = [];
  for (const check of checks) {
    try {
      const response = await fetch(check.request, { signal: AbortSignal.timeout(30_000) });
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
