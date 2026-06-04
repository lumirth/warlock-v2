import { describe, expect, it, vi } from 'vitest';
import { parseGenerateSubjectsArgs, resolveSubjects } from '../generate-subjects.ts';

describe('generate subjects', () => {
  it('uses D1 before hardcoded fallback when CISAPI is unavailable', async () => {
    const fetchFromD1 = vi.fn(() => [{ id: 'CS', name: 'Computer Science' }]);

    const subjects = await resolveSubjects({
      fetchFromCisApi: async () => [],
      fetchFromD1,
    });

    expect(fetchFromD1).toHaveBeenCalledTimes(1);
    expect(subjects).toEqual([{ id: 'CS', name: 'Computer Science' }]);
  });

  it('refuses to generate from fallback subjects unless explicitly requested', async () => {
    await expect(resolveSubjects({
      fetchFromCisApi: async () => [],
      fetchFromD1: () => [],
    })).rejects.toThrow('No authoritative subject source returned data');
  });

  it('supports an explicit hardcoded fallback flag', () => {
    expect(parseGenerateSubjectsArgs(['--allow-hardcoded-fallback'])).toEqual({
      allowHardcodedFallback: true,
    });
  });
});
