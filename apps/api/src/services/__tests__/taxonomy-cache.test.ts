import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaxonomyCache, loadTaxonomyCache } from '../taxonomy-cache.js';

const mockDb = {
  prepare: vi.fn(() => ({
    all: vi.fn()
  }))
};

describe('TaxonomyCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadTaxonomyCache', () => {
    it('loads subjects from database', async () => {
      const mockSubjects = { results: [
        { id: 'CS', name: 'Computer Science' },
        { id: 'MATH', name: 'Mathematics' }
      ]};
      const mockSubjectAliases = { results: [
        { subject_id: 'CS', alias: 'computer science' },
        { subject_id: 'CS', alias: 'comp sci' }
      ]};
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.subjects.byCode.get('CS')).toEqual({ id: 'CS', name: 'Computer Science' });
      expect(cache.subjects.byAlias.get('computer science')).toBe('CS');
      expect(cache.subjects.byAlias.get('comp sci')).toBe('CS');
    });

    it('normalizes aliases to lowercase', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [{ subject_id: 'CS', alias: 'COMP SCI' }] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.subjects.byAlias.get('comp sci')).toBe('CS');
    });
  });

  describe('TaxonomyCache.resolveSubject', () => {
    it('resolves subject code directly', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.resolveSubject('CS')).toBe('CS');
      expect(cache.resolveSubject('cs')).toBe('CS');
    });

    it('resolves subject from alias', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [{ subject_id: 'CS', alias: 'computer science' }] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.resolveSubject('computer science')).toBe('CS');
    });

    it('returns null for unknown subject', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.resolveSubject('xyz')).toBeNull();
    });
  });

  describe('TaxonomyCache.resolveGened', () => {
    it('resolves gened from alias', async () => {
      const mockSubjects = { results: [] };
      const mockSubjectAliases = { results: [] };
      const mockGenedAliases = { results: [{ gened_code: 'HUM', alias: 'humanities' }] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);
      expect(cache.resolveGened('humanities')).toBe('HUM');
      expect(cache.resolveGened('HUM')).toBe('HUM');
    });
  });

  describe('TaxonomyCache.expandTopic', () => {
    it('expands topic abbreviation', async () => {
      const mockSubjects = { results: [] };
      const mockSubjectAliases = { results: [] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [{ abbreviation: 'ml', expansion: 'machine learning' }] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);
      expect(cache.expandTopic('ml')).toBe('machine learning');
      expect(cache.expandTopic('ML')).toBe('machine learning');
    });
  });

  describe('TaxonomyCache.findSubjectInText', () => {
    let cache: TaxonomyCache;

    beforeEach(async () => {
      const mockSubjects = { results: [
        { id: 'CS', name: 'Computer Science' },
        { id: 'MATH', name: 'Mathematics' }
      ]};
      const mockSubjectAliases = { results: [
        { subject_id: 'CS', alias: 'computer science' },
        { subject_id: 'CS', alias: 'comp sci' }
      ]};
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      cache = await loadTaxonomyCache(mockDb as any);
    });

    it('finds longest matching alias first', () => {
      // "Computer Science" (length 16) vs "CS" (length 2)
      // Both map to CS. The input contains the full name.
      // Prioritize longest match to avoid partial matches if they overlap (though here they don't exactly overlap in a conflicting way, but priority logic is key)

      const result = cache.findSubjectInText('Intro to Computer Science 101');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('CS');
      expect(result?.match.toLowerCase()).toBe('computer science');
    });

    it('matches whole words only', () => {
      // "MATH" shouldn't match "Mathematics" if we only look for "MATH"
      // MATH is an alias for MATH (id). Mathematics is the name.
      // "Mathematics" (name) is also added as an alias in loadTaxonomyCache.
      // So "Mathematics" should match "Mathematics".

      const matchMathName = cache.findSubjectInText('Mathematics 200');
      expect(matchMathName?.code).toBe('MATH');
      expect(matchMathName?.match.toLowerCase()).toBe('mathematics');

      // But "MATH" should NOT match "Mathemagics" if that were a word, or part of a word.
      // Let's try a case where a short alias might match inside a word.
      // CS matches inside "Physics"? No, 'cs' is in Physics.

      const resultPhysics = cache.findSubjectInText('Physics 100');
      // CS should not be found in Physics despite 'cs' being at the end
      expect(resultPhysics).toBeNull();
    });

    it('matches short code when standing alone', () => {
      const result = cache.findSubjectInText('CS 225');
      expect(result?.code).toBe('CS');
      expect(result?.match).toMatch(/CS/i);
    });

    it('returns null when no subject found', () => {
      const result = cache.findSubjectInText('Hello World');
      expect(result).toBeNull();
    });
  });
});
