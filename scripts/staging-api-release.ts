import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/run-cli.ts';

type Target = 'staging' | 'production';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const PROFILES = {
  staging: {
    prefix: 'STAGING',
    environment: 'staging',
    baseUrl: 'https://uiuc-course-search-staging.lumirth.workers.dev',
  },
  production: {
    prefix: 'PRODUCTION',
    environment: undefined,
    baseUrl: 'https://uiuc-course-search.lumirth.workers.dev',
  },
} as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function wrangler(args: string[], environment?: string): void {
  const result = spawnSync('npx', [
    '--no-install',
    'wrangler',
    ...args,
    '--config',
    join(repoRoot, 'apps/api/wrangler.toml'),
    ...(environment ? ['--env', environment] : []),
  ], { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Wrangler failed: ${args.join(' ')}`);
}

async function healthcheck(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await catalogReady(baseUrl)) return;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Deployed Worker has no active catalog term at ${baseUrl}.`);
}

async function catalogReady(baseUrl: string): Promise<boolean> {
  const response = await fetch(baseUrl, {
    headers: { 'Cache-Control': 'no-cache' },
  }).catch(() => undefined);
  const body = await response?.json().catch(() => null) as { term?: unknown } | null;
  return response?.status === 200 && typeof body?.term === 'string';
}

async function bootstrapCatalog(
  baseUrl: string,
  prefix: string,
): Promise<Record<string, string>> {
  const headers = { Authorization: `Bearer ${required(`${prefix}_ADMIN_TOKEN`)}` };
  await adminRequest(baseUrl, '/admin/discover-terms', headers);
  for (let step = 0; step < 64; step += 1) {
    const sync = await adminRequest(baseUrl, '/admin/sync', headers) as {
      catalogReady?: boolean;
      processed?: { termId?: string; subjects?: string[]; failedSubjects?: number } | null;
    };
    if (sync.catalogReady) return headers;
    if (sync.processed) {
      console.log(`Catalog step ${step + 1}: ${sync.processed.termId} `
        + `${sync.processed.subjects?.length ?? 0} subjects, `
        + `${sync.processed.failedSubjects ?? 0} failed.`);
    } else {
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
  throw new Error('Initial catalog sync exceeded 64 bounded steps.');
}

async function bootstrapGpa(baseUrl: string, headers: Record<string, string>): Promise<void> {
  const status = await adminRequest(baseUrl, '/admin/sync/status', headers, 'GET') as {
    jobs?: Array<{ id?: string; last_status?: string; items_synced?: number }>;
  };
  if (status.jobs?.some(job => job.id === 'gpa'
    && job.last_status === 'complete' && (job.items_synced ?? 0) > 0)) return;
  const reset = await adminRequest(baseUrl, '/admin/gpa', headers, 'DELETE') as { result?: string };
  if (reset.result !== 'reset_initiated') throw new Error('Initial GPA reset was not accepted.');
  for (let chunk = 0; chunk < 64; chunk += 1) {
    const result = await adminRequest(baseUrl, '/admin/gpa', headers) as { isComplete?: boolean };
    if (result.isComplete) return;
  }
  throw new Error('Initial GPA import exceeded 64 chunks.');
}

async function adminRequest(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  method = 'POST',
): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(4 * 60_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
  return body;
}

async function main(): Promise<void> {
  const target = process.argv.includes('--target')
    ? process.argv[process.argv.indexOf('--target') + 1]
    : 'staging';
  if (target !== 'staging' && target !== 'production') {
    throw new Error('Usage: staging-api-release.ts [--target staging|production]');
  }
  const profile = PROFILES[target as Target];
  wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], profile.environment);
  wrangler([
    'd1', 'execute', 'DB', '--remote',
    '--command', 'SELECT owner_token FROM sync_state LIMIT 0',
  ], profile.environment);
  wrangler(['deploy', '--strict'], profile.environment);
  const admin = await bootstrapCatalog(profile.baseUrl, profile.prefix);
  await bootstrapGpa(profile.baseUrl, admin);
  await healthcheck(profile.baseUrl);
  console.log(`${target} Worker release passed migration, deploy, and health gates.`);
}

runCli(import.meta.url, main);
