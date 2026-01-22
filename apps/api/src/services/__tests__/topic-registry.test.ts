import { describe, it, expect } from 'vitest';
import { expandTopics, TOPIC_MAP } from '../topic-registry.js';

describe('topic-registry', () => {
  describe('expandTopics', () => {
    it('expands common abbreviations', () => {
      const query = 'ai and ml';
      const expansions = expandTopics(query);
      expect(expansions).toContain('artificial intelligence');
      expect(expansions).toContain('machine learning');
    });

    it('is case-insensitive', () => {
      const query = 'AI and ML';
      const expansions = expandTopics(query);
      expect(expansions).toContain('artificial intelligence');
      expect(expansions).toContain('machine learning');
    });

    it('handles queries with no abbreviations', () => {
      const query = 'calculus and physics';
      const expansions = expandTopics(query);
      expect(expansions).toHaveLength(0);
    });

    it('handles punctuation correctly', () => {
      const query = 'ai, ml; os!';
      const expansions = expandTopics(query);
      expect(expansions).toContain('artificial intelligence');
      expect(expansions).toContain('machine learning');
      expect(expansions).toContain('operating systems');
    });

    it('handles empty query', () => {
      expect(expandTopics('')).toHaveLength(0);
    });
  });

  describe('TOPIC_MAP', () => {
    it('contains expected mappings', () => {
      expect(TOPIC_MAP['ai']).toBe('artificial intelligence');
      expect(TOPIC_MAP['ml']).toBe('machine learning');
      expect(TOPIC_MAP['os']).toBe('operating systems');
    });
  });
});
