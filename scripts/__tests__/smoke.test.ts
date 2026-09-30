import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it.each(['ready', 'empty catalog', 'empty search'])(
  'checks populated search against the published term: %s',
  async state => {
    let requestedOffering: string | null = null;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      const url = new URL(request.url ?? '/', 'http://localhost');
      let body: unknown = {};
      if (url.pathname === '/') body = { term: state === 'empty catalog' ? null : 'spring 2027' };
      if (url.pathname === '/api/search') {
        requestedOffering = `${url.searchParams.get('term')} ${url.searchParams.get('year')}`;
        body = { results: state === 'empty search' ? [] : [{ course: { subject: 'CS', number: '225' } }] };
      }
      if (url.pathname === '/api/course/CS/225') body = {
        course: { subject: 'CS', number: '225', links: { courseExplorerUrl: 'https://courses.illinois.edu/' } },
      };
      if (url.pathname === '/api/feedback') response.statusCode = 400;
      if (url.pathname === '/admin/sync/status') {
        if (request.headers.authorization !== 'Bearer operator-test-token') response.statusCode = 401;
        body = { terms: [], jobs: [], incompleteSubjects: [] };
      }
      response.end(JSON.stringify(body));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const task = execute(process.execPath, [
      'node_modules/tsx/dist/cli.mjs', 'scripts/smoke.ts', '--target', 'production',
    ], {
      timeout: 15_000,
      env: {
        ...process.env,
        PRODUCTION_ADMIN_TOKEN: 'operator-test-token',
        PRODUCTION_API_BASE_URL: `http://127.0.0.1:${address.port}`,
        SMOKE_SUBJECT: 'CS',
        SMOKE_NUMBER: '225',
        SMOKE_TERM: '',
        SMOKE_YEAR: '',
        STAGING_SMOKE_TERM: '',
        STAGING_SMOKE_YEAR: '',
      },
    });
    try {
      if (state === 'ready') {
        expect((await task).stdout).toContain('PASS search contract');
        expect(requestedOffering).toBe('spring 2027');
      } else {
        await expect(task).rejects.toMatchObject({
          stderr: expect.stringContaining(state === 'empty catalog'
            ? 'No populated current catalog term' : 'search contract'),
        });
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  },
);
