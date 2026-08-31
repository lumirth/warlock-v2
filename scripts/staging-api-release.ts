import { spawnSync } from 'node:child_process';
import { request } from 'node:https';
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
): Promise<Record<string, string> | null> {
  if (await catalogReady(baseUrl)) return null;
  const headers = { Authorization: `Bearer ${required(`${prefix}_ADMIN_TOKEN`)}` };
  await adminRequest(baseUrl, '/admin/discover-terms', headers);
  const sync = await adminRequest(baseUrl, '/admin/sync', headers) as {
    termCount?: number;
    failedTermCount?: number;
  };
  if (!sync.termCount || sync.failedTermCount) throw new Error('Initial catalog sync did not complete.');
  return headers;
}

async function bootstrapGpa(baseUrl: string, headers: Record<string, string>): Promise<void> {
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
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, { method, headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`${path} returned HTTP ${status}.`));
          return;
        }
        try { resolve(text ? JSON.parse(text) : null); }
        catch { reject(new Error(`${path} returned invalid JSON.`)); }
      });
    });
    req.setTimeout(30 * 60_000, () => req.destroy(new Error(`${path} timed out.`)));
    req.on('error', reject);
    req.end();
  });
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
  if (admin) await bootstrapGpa(profile.baseUrl, admin);
  await healthcheck(profile.baseUrl);
  console.log(`${target} Worker release passed migration, deploy, and health gates.`);
}

runCli(import.meta.url, main);
