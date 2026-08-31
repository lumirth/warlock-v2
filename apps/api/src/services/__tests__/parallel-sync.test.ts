import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserFetch } from '../../http/browser-fetch.js';
import { writeSubjectSnapshotToD1 } from '../course-snapshot-writer.js';
import { syncSubjects } from '../parallel-sync.js';

vi.mock('../../http/browser-fetch.js', () => ({ browserFetch: vi.fn() }));
vi.mock('../../cisapi/parser.js', () => ({
  parseSubjectCascadeXml: vi.fn(() => ({})),
  parseSubjectsXml: vi.fn(() => []),
}));
vi.mock('../../transforms/course.js', () => ({ fromSubjectCascade: vi.fn(() => ({})) }));
vi.mock('../course-snapshot-writer.js', () => ({
  writeSubjectSnapshotToD1: vi.fn(async () => ({ coursesCount: 1, sectionsCount: 1 })),
}));

describe('subject sync waves', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs at most five subject pipelines at once and retains every result in order', async () => {
    const subjects = Array.from({ length: 20 }, (_, index) => `S${String(index).padStart(2, '0')}`);
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    vi.mocked(browserFetch).mockImplementation(() => new Promise(resolve => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      releases.push(() => {
        active -= 1;
        resolve(new Response('<subject/>'));
      });
    }));

    const result = syncSubjects(database(), { cisapiBase: 'https://courses.test' }, 2026, 'fall', subjects);

    for (const started of [5, 10, 15, 20]) {
      await vi.waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(started));
      expect(releases).toHaveLength(5);
      expect(maxActive).toBe(5);
      releases.splice(0).forEach(release => release());
    }

    const completed = await result;
    expect(completed).toMatchObject({ successfulSubjects: 20, failedSubjects: 0 });
    expect(completed.subjectResults.map(item => item.subject)).toEqual(subjects);
    expect(writeSubjectSnapshotToD1).toHaveBeenCalledTimes(20);
  });
});

function database(): D1Database {
  return {
    prepare() {
      const statement = {
        bind: () => statement,
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    },
  } as unknown as D1Database;
}
