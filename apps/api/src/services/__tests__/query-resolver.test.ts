import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractionResult } from '../extractor.js';
import { resolveQuery } from '../query-resolver.js';
import type { Hint, HintType, HintValueByType } from '../search-planner-types.js';

const mockDb = {
  prepare: vi.fn<(sql: string) => unknown>(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(),
      all: vi.fn(),
    })),
  })),
};

function hint<T extends HintType>(
  type: T,
  value: HintValueByType[T],
  raw = typeof value === 'string' ? value : JSON.stringify(value),
): Extract<Hint, { type: T }> {
  return {
    type,
    value,
    metadata: {
      source: 'regex',
      confidence: 0.9,
      raw,
    },
  } as Extract<Hint, { type: T }>;
}

function resolve(rawQuery: string, hints: Hint[], residual = '') {
  const extraction: ExtractionResult = { hints, residual };
  return resolveQuery(mockDb as unknown as D1Database, rawQuery, extraction);
}

function mockSubjectLookup(subject: string, name: string) {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn()
      .mockResolvedValueOnce({ id: subject })
      .mockResolvedValueOnce({ name }),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  mockDb.prepare.mockReturnValue(statement);
  return statement;
}

describe('resolveQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps course-code hints structured through subject validation', async () => {
    mockSubjectLookup('CS', 'Computer Science');

    const plan = await resolve(
      'CS 225',
      [hint('courseCode', { subject: 'CS', number: '225' }, 'CS 225')],
    );

    expect(plan.filters).toMatchObject({ subject: 'CS', number: '225' });
    expect(plan.semanticQuery).toBe('');
    expect(plan.ambiguities).toBeUndefined();
  });

  it('falls back to text retrieval when a structured course-code subject is invalid', async () => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    mockDb.prepare.mockReturnValue(statement);

    const plan = await resolve(
      'XYZ 999',
      [hint('courseCode', { subject: 'XYZ', number: '999' }, 'XYZ 999')],
    );

    expect(plan.filters.subject).toBeUndefined();
    expect(plan.filters.number).toBeUndefined();
    expect(plan.semanticQuery).toBe('XYZ 999');
  });

  it('resolves instructor names and preserves over-captured topic text', async () => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn()
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({ results: [] })
        .mockResolvedValueOnce({ results: [{ id: 3365 }] }),
      first: vi.fn(),
    };
    mockDb.prepare.mockReturnValue(statement);

    const plan = await resolve(
      'professor fagen algorithms',
      [hint('instructor', 'fagen algorithms')],
    );

    expect(plan.filters.instructor_ids).toEqual([3365]);
    expect(plan.semanticQuery).toBe('algorithms');
    expect(statement.bind).toHaveBeenNthCalledWith(3, '%fagen%', '%fagen%');
  });

  it('maps requirement language into a canonical requirement filter', async () => {
    const plan = await resolve(
      'easy humanities gened',
      [hint('requirement', 'humanities')],
      'easy',
    );

    expect(plan.filters.requirement).toEqual({ mode: 'single', codes: ['HUM'] });
    expect(plan.semanticQuery).toBe('easy');
  });

  it('uses shopping context to resolve ambiguous CS shorthand as Cultural Studies', async () => {
    mockSubjectLookup('CS', 'Computer Science');

    const plan = await resolve('easy cs', [hint('subject', 'CS', 'cs')], 'easy');

    expect(plan.filters.subject).toBeUndefined();
    expect(plan.filters.requirement).toEqual({ mode: 'single', codes: ['CS'] });
    expect(plan.ambiguities).toEqual([{
      term: 'cs',
      chosen: { type: 'requirement', value: 'CS', label: 'Cultural Studies' },
      alternatives: [{ type: 'subject', value: 'CS', label: 'Computer Science' }],
    }]);
  });

  it('keeps explicit Computer Science language as the subject', async () => {
    mockSubjectLookup('CS', 'Computer Science');

    const plan = await resolve(
      'easy computer science',
      [hint('subject', 'CS', 'computer science')],
      'easy',
    );

    expect(plan.filters.subject).toBe('CS');
    expect(plan.filters.requirement).toBeUndefined();
    expect(plan.ambiguities).toBeUndefined();
  });

  it('applies canonical structured attribute values without string reconstruction', async () => {
    const plan = await resolve('filters', [
      hint('days', 'MWF'),
      hint('time', 'morning'),
      hint('partOfTerm', 'A'),
      hint('term', { term: 'spring', year: 2026 }),
      hint('level', 400),
      hint('credits', 3),
      hint('online', false),
      hint('status', 'open'),
      hint('workload', 'easy'),
    ]);

    expect(plan.filters).toMatchObject({
      days: 'MWF',
      time: 'morning',
      partOfTerm: 'A',
      term: 'spring',
      year: 2026,
      level: 400,
      credits: 3,
      online: false,
      status: 'open',
      workload: 'easy',
    });
  });

  it('applies structured negation without promoting the excluded subject', async () => {
    const plan = await resolve(
      'science but no math',
      [hint('negation', { target: 'subject', value: 'MATH' }, 'no math')],
      'science',
    );

    expect(plan.filters.subject).toBeUndefined();
    expect(plan.filters.not?.subjects).toEqual(['MATH']);
  });
});
