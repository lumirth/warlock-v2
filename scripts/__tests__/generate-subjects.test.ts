import { describe, expect, it, vi } from 'vitest';
import { resolveSubjects } from '../generate-subjects.ts';

describe('generate subjects', () => {
  it('uses D1 when Course Explorer is unavailable', async () => {
    const fetchFromD1 = vi.fn(() => [{ id: 'CS', name: 'Computer Science' }]);

    const subjects = await resolveSubjects({
      fetchFromCisApi: async () => [],
      fetchFromD1,
    });

    expect(fetchFromD1).toHaveBeenCalledTimes(1);
    expect(subjects).toEqual([{ id: 'CS', name: 'Computer Science' }]);
  });

  it('refuses to overwrite the committed catalog without an authoritative source', async () => {
    await expect(resolveSubjects({
      fetchFromCisApi: async () => [],
      fetchFromD1: () => [],
    })).rejects.toThrow('No authoritative subject source returned data');
  });
});
