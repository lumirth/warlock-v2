import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSubjectsForTerm, syncSubjects } from '../parallel-sync.js';
import { coordinateCourseSync } from '../sync-coordinator.js';

vi.mock('../parallel-sync.js', () => ({
  SUBJECT_LEASE_TTL_SECONDS: 300,
  getSubjectsForTerm: vi.fn(),
  syncSubjects: vi.fn(),
}));
vi.mock('../term-subject-manifest.js', () => ({
  reconcileTermSubjectManifest: vi.fn(async () => ({ applied: true, deletedCourseCount: 0 })),
}));

type State = { status: 'pending' | 'running' | 'complete' | 'failed'; lastSync: number };
type Term = {
  term_id: string;
  year: number;
  term: string;
  status: 'registrable' | 'active';
  last_checked: number | null;
  last_synced: number | null;
  subjects_count: number | null;
  courses_count: number | null;
  sections_count: number | null;
  sync_errors: string | null;
};

describe('bounded course sync coordinator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes at most one twenty-subject step and resumes from durable state', async () => {
    const term = makeTerm('2026-fall', 2026, 'fall');
    const subjects = Array.from({ length: 25 }, (_, index) => `S${String(index).padStart(2, '0')}`);
    const state = new Map<string, State>();
    const db = fakeDb([term], state);
    vi.mocked(getSubjectsForTerm).mockResolvedValue(subjects);
    completeDispatchedSubjects(state);

    const first = await coordinateCourseSync(env(db));
    const second = await coordinateCourseSync(env(db));

    expect(first.processed?.subjects).toHaveLength(20);
    expect(first.catalogReady).toBe(false);
    expect(second.processed?.subjects).toHaveLength(5);
    expect(second.catalogReady).toBe(true);
    expect(syncSubjects).toHaveBeenCalledTimes(2);
  });

  it('recovers failed and stale leases without stealing a fresh lease', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const term = makeTerm('2026-fall', 2026, 'fall');
    const state = new Map<string, State>([
      [key(term, 'FRESH'), { status: 'running', lastSync: now }],
      [key(term, 'STALE'), { status: 'running', lastSync: now - 301 }],
      [key(term, 'FAIL'), { status: 'failed', lastSync: now - 10 }],
    ]);
    const db = fakeDb([term], state);
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['FRESH', 'STALE', 'FAIL', 'MISS']);
    completeDispatchedSubjects(state);

    const result = await coordinateCourseSync(env(db));

    expect(result.processed?.subjects).toEqual(['MISS', 'STALE', 'FAIL']);
    expect(result.terms).toEqual([{
      termId: term.term_id,
      total: 4,
      complete: 3,
      failed: 0,
      running: 1,
    }]);
    expect(result.catalogReady).toBe(false);
  });

  it('refreshes the globally oldest complete term without a cursor', async () => {
    const fall = makeTerm('2026-fall', 2026, 'fall');
    const spring = makeTerm('2026-spring', 2026, 'spring');
    const state = new Map<string, State>([
      [key(fall, 'CS'), { status: 'complete', lastSync: 200 }],
      [key(spring, 'MATH'), { status: 'complete', lastSync: 100 }],
    ]);
    const db = fakeDb([fall, spring], state);
    vi.mocked(getSubjectsForTerm).mockImplementation(async (_config, _year, term) =>
      term === 'fall' ? ['CS'] : ['MATH']);
    completeDispatchedSubjects(state);

    const result = await coordinateCourseSync(env(db), { refresh: true });

    expect(result.processed).toMatchObject({ termId: spring.term_id, subjects: ['MATH'] });
    expect(syncSubjects).toHaveBeenCalledOnce();
    expect(result.catalogReady).toBe(true);
  });
});

function completeDispatchedSubjects(state: Map<string, State>): void {
  vi.mocked(syncSubjects).mockImplementation(async (_db, _config, year, term, subjects) => {
    const now = Math.floor(Date.now() / 1_000);
    for (const subject of subjects) state.set(`${year}-${term}:${subject}`, { status: 'complete', lastSync: now });
    return {
      termId: `${year}-${term}`,
      year,
      term,
      subjectResults: subjects.map(subject => ({
        subject,
        success: true,
        coursesCount: 1,
        sectionsCount: 1,
        durationMs: 1,
      })),
      totalCourses: subjects.length,
      totalSections: subjects.length,
      successfulSubjects: subjects.length,
      failedSubjects: 0,
      durationMs: 1,
      rateLimitHits: 0,
    };
  });
}

function fakeDb(terms: Term[], state: Map<string, State>): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          return statement;
        },
        async all() {
          if (sql.includes('SELECT * FROM term_state')) return { results: terms, success: true };
          if (sql.includes('FROM json_each(?) AS manifest')) {
            const subjects = JSON.parse(String(values[0])) as string[];
            const termId = String(values[1]);
            return {
              success: true,
              results: subjects.map(subject => ({
                subject,
                status: state.get(`${termId}:${subject}`)?.status ?? null,
                lastSync: state.get(`${termId}:${subject}`)?.lastSync ?? null,
              })),
            };
          }
          throw new Error(`unexpected all(): ${sql}`);
        },
        async run() {
          return { success: true };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function env(db: D1Database) {
  return { DB: db, CISAPI_BASE: 'https://courses.test' };
}

function makeTerm(termId: string, year: number, term: string): Term {
  return {
    term_id: termId,
    year,
    term,
    status: 'active',
    last_checked: null,
    last_synced: null,
    subjects_count: null,
    courses_count: null,
    sections_count: null,
    sync_errors: null,
  };
}

function key(term: Term, subject: string): string {
  return `${term.term_id}:${subject}`;
}
