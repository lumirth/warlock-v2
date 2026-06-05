import { describe, expect, it, vi } from 'vitest';
import { formatReport, runStagingSmoke, STAGING_SMOKE_CHECK_NAMES } from '../staging-smoke.js';

type MockOptions = {
  syncStatusBody?: unknown;
};

const ENV = {
  STAGING_API_BASE_URL: 'https://staging.example.test',
  STAGING_ADMIN_TOKEN: 'admin-token',
  STAGING_INTERNAL_TOKEN: 'internal-token',
  STAGING_SMOKE_SUBJECT: 'CS',
  STAGING_SMOKE_NUMBER: '225',
  STAGING_SMOKE_TERM: 'spring',
  STAGING_SMOKE_YEAR: '2026',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFetcher(options: MockOptions = {}) {
  return vi.fn(async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const auth = request.headers.get('Authorization');

    if (url.pathname === '/health') {
      return json(200, { healthy: true });
    }
    if (url.pathname === '/api/search') {
      if (url.searchParams.get('q') === 'professor fagen algorithms') {
        return json(200, {
          results: [],
          meta: {
            nextRequest: {
              filters: {
                instructor: 'fagen',
              },
            },
          },
        });
      }

      return json(200, { results: [] });
    }
    if (url.pathname === '/api/course/CS/225') {
      return json(200, {
        course: {
          subject: 'CS',
          number: '225',
          links: {
            courseExplorerUrl: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
          },
          sections: [{
            crn: '12345',
            links: {
              courseExplorerUrl: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
            },
          }],
        },
      });
    }
    if (url.pathname === '/api/feedback') {
      return request.method === 'POST'
        ? json(202, { id: 'feedback-1', status: 'accepted', received_at: 1780380000 })
        : json(405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/admin/upstream-backoff-status') {
      return auth === 'Bearer admin-token'
        ? json(200, { ok: true })
        : json(401, { error: 'Unauthorized' });
    }
    if (url.pathname === '/admin/sync/status') {
      return auth === 'Bearer admin-token'
        ? json(200, options.syncStatusBody ?? {
          syncStates: [],
          termStates: [],
          unhealthySyncStates: [],
          runningSyncStates: [],
        })
        : json(401, { error: 'Unauthorized' });
    }
    if (url.pathname === '/internal/sync-batch') {
      return auth === 'Bearer internal-token'
        ? json(400, { error: 'Validation failed' })
        : json(401, { error: 'Unauthorized' });
    }

    return json(404, { error: 'Not found' });
  });
}

describe('staging smoke', () => {
  it('runs all staging smoke checks without writing artifacts when disabled', async () => {
    const fetcher = makeFetcher();
    const results = await runStagingSmoke({
      env: ENV,
      fetcher,
      writeArtifacts: false,
      log: () => undefined,
    });

    expect(results.every(result => result.ok)).toBe(true);
    expect(results.map(result => result.name)).toEqual([...STAGING_SMOKE_CHECK_NAMES]);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(formatReport(results)).toContain('Passing checks: 10');
  });

  it('fails when admin sync status does not expose operator health arrays', async () => {
    const results = await runStagingSmoke({
      env: ENV,
      fetcher: makeFetcher({ syncStatusBody: { syncStates: [] } }),
      writeArtifacts: false,
      log: () => undefined,
    });

    const syncStatus = results.find(result => result.name === 'admin sync status accepts staging token');
    expect(syncStatus).toEqual(expect.objectContaining({
      ok: false,
      detail: 'expected sync status arrays',
    }));
  });

  it('fails fast when the staging base URL is missing', async () => {
    await expect(runStagingSmoke({
      env: {},
      fetcher: makeFetcher(),
      writeArtifacts: false,
      log: () => undefined,
    })).rejects.toThrow('STAGING_API_BASE_URL is required');
  });
});
