import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, type Bindings } from '../../http-app.js';

const testEnv = env as unknown as Bindings;

describe('sync status HTTP boundary with migrated D1', () => {
  beforeEach(async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM subject_sync_state'),
      testEnv.DB.prepare('DELETE FROM sync_state'),
      testEnv.DB.prepare('DELETE FROM term_state'),
      testEnv.DB.prepare(`
        INSERT INTO term_state (term_id, year, term, status, last_checked)
        VALUES ('2026-fall', 2026, 'fall', 'active', 1)
      `),
      testEnv.DB.prepare(`
        INSERT INTO term_state (term_id, year, term, status, last_checked)
        VALUES ('2025-spring', 2025, 'spring', 'historical', 1)
      `),
      testEnv.DB.prepare(`
        INSERT INTO sync_state (id, last_sync, last_status, items_synced)
        VALUES ('gpa', 1, 'failed', 20)
      `),
      testEnv.DB.prepare(`
        INSERT INTO subject_sync_state
          (term_id, subject, last_sync, status, courses_synced, sections_synced, error)
        VALUES ('2026-fall', 'CS', 1, 'failed', 0, 0, 'upstream')
      `),
    ]);
  });

  it('returns ordered public term options from D1', async () => {
    const response = await app.request('/api/terms', {}, testEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      terms: [
        { termId: '2026-fall', year: 2026, term: 'fall', status: 'active', label: 'Fall 2026' },
        { termId: '2025-spring', year: 2025, term: 'spring', status: 'historical', label: 'Spring 2025' },
      ],
    });
  });

  it('protects and returns the real operator status contract', async () => {
    const missing = await app.request('/admin/sync/status', {}, {
      ...testEnv,
      ADMIN_TOKEN: 'secret',
    });
    expect(missing.status).toBe(401);

    const response = await app.request('/admin/sync/status', {
      headers: { Authorization: 'Bearer secret' },
    }, { ...testEnv, ADMIN_TOKEN: 'secret' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      terms: [{ term_id: '2026-fall' }, { term_id: '2025-spring' }],
      jobs: [{ id: 'gpa', last_status: 'failed' }],
      incompleteSubjects: [{ term_id: '2026-fall', subject: 'CS', status: 'failed' }],
    });
  });
});
