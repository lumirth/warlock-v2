import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@cloudflare/workers-types';
import { getTermsByStatus, touchTermStateChecked } from '../../db/term-state-repository.js';
import { getSubjectsForTerm } from '../parallel-sync.js';
import { coordinateCourseSync } from '../sync-coordinator.js';
import { MAX_SYNC_SUBJECTS_PER_REQUEST } from '../sync-batch-contract.js';

vi.mock('../../db/term-state-repository.js', () => ({
  getTermsByStatus: vi.fn(),
  touchTermStateChecked: vi.fn(),
}));

vi.mock('../parallel-sync.js', () => ({
  getSubjectsForTerm: vi.fn(),
}));

describe('coordinateCourseSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers active subjects and dispatches internal batches within the shared limit', async () => {
    vi.mocked(getTermsByStatus).mockImplementation(async (_db, status) => {
      if (status === 'registrable') {
        return [{
          term_id: '2026-spring',
          year: 2026,
          term: 'spring',
          status: 'registrable',
          last_checked: null,
          last_synced: null,
          subjects_count: null,
          courses_count: null,
          sections_count: null,
          sync_errors: null,
          created_at: 0,
          updated_at: 0,
        }];
      }
      return [];
    });
    vi.mocked(getSubjectsForTerm).mockResolvedValue(
      Array.from({ length: MAX_SYNC_SUBJECTS_PER_REQUEST + 1 }, (_, index) => `A${String.fromCharCode(65 + index)}`)
    );
    vi.mocked(touchTermStateChecked).mockResolvedValue(undefined);
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => new Response('', { status: 200 }));

    const result = await coordinateCourseSync({
      DB: {} as never,
      SELF: { fetch } as unknown as Fetcher,
      CISAPI_BASE: 'https://courses.example.test',
      SYNC_CONCURRENCY: '4',
      INTERNAL_TOKEN: 'internal-token',
    }, {
      runId: 'cron-test',
      cron: '17 * * * *',
      trigger: 'default_cron',
    });

    expect(result).toMatchObject({
      termCount: 1,
      failedTermCount: 0,
      results: [{ termId: '2026-spring', subjectCount: 21, batchCount: 2, failedBatchCount: 0 }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstBody = syncBatchBody(fetch.mock.calls[0]);
    const secondBody = syncBatchBody(fetch.mock.calls[1]);
    expect(firstBody).toMatchObject({
      year: 2026,
      term: 'spring',
      subjects: expect.arrayContaining(['AA']),
      totalSubjects: 21,
    });
    expect(firstBody.subjects).toHaveLength(MAX_SYNC_SUBJECTS_PER_REQUEST);
    expect(secondBody.subjects).toHaveLength(1);
    expect(touchTermStateChecked).toHaveBeenCalledWith(expect.anything(), '2026-spring', expect.any(Number));
  });
});

function syncBatchBody(call: [string, RequestInit?]) {
  return JSON.parse(String(call[1]?.body)) as { subjects: string[] };
}
