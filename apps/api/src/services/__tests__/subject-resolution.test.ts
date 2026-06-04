import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import { validateSubject } from '../subject-resolution.js';

describe('validateSubject', () => {
  it('skips fuzzy subject LIKE for broad expanded search text', async () => {
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    await expect(validateSubject(
      db as unknown as D1Database,
      'human compter interaction human computer interaction'
    )).resolves.toBeNull();

    expect(preparedSql.some(sql => sql.includes('LIKE'))).toBe(false);
  });

  it('keeps fuzzy subject lookup for concise subject-shaped text', async () => {
    const boundParams: unknown[][] = [];
    const statement = {
      bind: vi.fn((...params: unknown[]) => {
        boundParams.push(params);
        return statement;
      }),
      first: vi.fn().mockResolvedValue(null),
    };
    const db = {
      prepare: vi.fn(() => statement),
    };

    await validateSubject(db as unknown as D1Database, 'computer');

    expect(boundParams).toContainEqual(['%computer%', '%COMPUTER%']);
  });
});
