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
    baseUrl: 'https://warlock-staging.lumirth.workers.dev',
  },
  production: {
    prefix: 'PRODUCTION',
    environment: '',
    baseUrl: 'https://warlock.lumirth.workers.dev',
  },
} as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function wrangler(args: string[], environment: string): void {
  const result = spawnSync('npx', [
    '--no-install',
    'wrangler',
    ...args,
    '--config',
    join(repoRoot, 'apps/api/wrangler.toml'),
    '--env', environment,
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
  adminToken: string,
): Promise<Record<string, string>> {
  const headers = { Authorization: `Bearer ${adminToken}` };
  await adminRequest(baseUrl, '/admin/discover-terms', headers);
  for (let step = 0; step < 64; step += 1) {
    let sync: {
      catalogReady?: boolean;
      processed?: { termId?: string; subjects?: string[]; failedSubjects?: number } | null;
    };
    try {
      sync = await adminRequest(baseUrl, '/admin/sync', headers) as typeof sync;
    } catch (error) {
      if (!(error instanceof Error)
        || (error.name !== 'TimeoutError' && error.name !== 'AbortError')) throw error;
      console.warn(`Catalog step ${step + 1} timed out; resuming from durable subject state.`);
      continue;
    }
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
  const gpa = status.jobs?.find(job => job.id === 'gpa');
  if (gpa?.last_status === 'complete' && (gpa.items_synced ?? 0) > 0) return;
  if (!gpa || gpa.last_status === 'complete') {
    const reset = await adminRequest(baseUrl, '/admin/gpa', headers, 'DELETE') as { result?: string };
    if (reset.result !== 'reset_initiated') throw new Error('Initial GPA reset was not accepted.');
  }
  for (let chunk = 0; chunk < 64; chunk += 1) {
    const result = await adminRequest(baseUrl, '/admin/gpa', headers) as {
      success?: boolean; isComplete?: boolean; message?: string;
    };
    if (!result.success) throw new Error(result.message ?? 'GPA import failed.');
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
  const args = process.argv.slice(2);
  const target = args.length === 0 ? 'staging'
    : args.length === 2 && args[0] === '--target' ? args[1] : undefined;
  if (target !== 'staging' && target !== 'production') {
    throw new Error('Usage: release-api.ts [--target staging|production]');
  }
  const profile = PROFILES[target as Target];
  const adminToken = required(`${profile.prefix}_ADMIN_TOKEN`);
  const baseUrl = process.env[`${profile.prefix}_API_BASE_URL`]?.trim() || profile.baseUrl;
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('The API base URL must use HTTPS.');
  }
  wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], profile.environment);
  wrangler([
    'd1', 'execute', 'DB', '--remote',
    '--command', 'SELECT owner_token FROM sync_state LIMIT 0',
  ], profile.environment);
  wrangler(['deploy', '--strict'], profile.environment);
  const admin = await bootstrapCatalog(baseUrl.replace(/\/+$/, ''), adminToken);
  await bootstrapGpa(baseUrl.replace(/\/+$/, ''), admin);
  await healthcheck(baseUrl);
  console.log(`${target} Worker release passed migration, deploy, and health gates.`);
}

runCli(import.meta.url, main);
