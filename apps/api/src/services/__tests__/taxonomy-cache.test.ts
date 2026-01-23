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
});
