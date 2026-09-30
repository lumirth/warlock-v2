import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'uiuc-release-test-'));
  directories.push(directory);
  const marker = join(directory, 'remote-changes');
  await writeFile(join(directory, 'npx'), '#!/usr/bin/env node\n'
    + "require('node:fs').appendFileSync(process.env.RELEASE_TEST_MARKER, 'changed\\n');\n",
  { mode: 0o755 });
  return {
    marker,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      RELEASE_TEST_MARKER: marker,
      STAGING_ADMIN_TOKEN: '',
      PRODUCTION_ADMIN_TOKEN: '',
    },
  };
}

function release(args: string[], env: NodeJS.ProcessEnv) {
  return execute(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', 'scripts/release-api.ts', ...args,
  ], { env, timeout: 15_000 });
}

it.each([
  { args: [], error: 'STAGING_ADMIN_TOKEN is required' },
  { args: ['--target', 'production'], error: 'PRODUCTION_ADMIN_TOKEN is required' },
  { args: ['--targte', 'production'], error: 'Usage:' },
])('rejects invalid release input before changing remote resources: $args', async ({ args, error }) => {
  const setup = await fixture();
  await expect(release(args, setup.env)).rejects.toMatchObject({ stderr: expect.stringContaining(error) });
  await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects an insecure remote API URL before changing remote resources', async () => {
  const setup = await fixture();
  await expect(release([], {
    ...setup.env,
    STAGING_ADMIN_TOKEN: 'operator-test-token',
    STAGING_API_BASE_URL: 'http://remote.example',
  })).rejects.toMatchObject({ stderr: expect.stringContaining('must use HTTPS') });
  await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([true, false])('resumes staged GPA data and reports import success accurately: %s', async success => {
  const setup = await fixture();
  let reset = false;
  let resumed = false;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== 'Bearer operator-test-token' && request.url !== '/') {
      response.writeHead(401).end('{}');
      return;
    }
    let body: unknown = {};
    if (request.url === '/admin/sync') body = { catalogReady: true };
    if (request.url === '/admin/sync/status') body = {
      jobs: [{ id: 'gpa', last_status: 'running', items_synced: 100 }],
    };
    if (request.url === '/admin/gpa') {
      if (request.method === 'DELETE') {
        reset = true;
        body = { result: 'reset_initiated' };
      } else {
        resumed = true;
        body = { success, isComplete: success, message: 'GPA import is already running' };
      }
    }
    if (request.url === '/') body = { term: 'spring 2027' };
    response.end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const task = release([], {
    ...setup.env,
    STAGING_ADMIN_TOKEN: 'operator-test-token',
    STAGING_API_BASE_URL: `http://127.0.0.1:${address.port}`,
  });
  try {
    if (success) {
      expect((await task).stdout).toContain('release passed');
    } else {
      await expect(task).rejects.toMatchObject({
        stderr: expect.stringContaining('GPA import is already running'),
        stdout: expect.not.stringContaining('release passed'),
      });
    }
    expect(resumed).toBe(true);
    expect(reset).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
