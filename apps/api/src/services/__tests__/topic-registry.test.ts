import { describe, it, expect } from 'vitest';
import { expandTopics } from '../topic-registry.js';

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
      const query = 'ai/ml; os!';
      const expansions = expandTopics(query);
      expect(expansions).toContain('artificial intelligence');
      expect(expansions).toContain('machine learning');
      expect(expansions).toContain('operating systems');
    });

    it('expands topic synonyms and phrase variants', () => {
      expect(expandTopics('database systems')).toContain('database');
      expect(expandTopics('cyber security')).toContain('cybersecurity');
      expect(expandTopics('user experience')).toContain('human computer interaction');
      expect(expandTopics('software development')).toContain('software engineering');
      expect(expandTopics('intro to compilers')).toContain('compiler design programming languages');
      expect(expandTopics('c++')).toContain('c++ programming');
    });

    it('expands longer typoed topic aliases conservatively', () => {
      expect(expandTopics('artifical inteligence')).toContain('artificial intelligence');
      expect(expandTopics('machne learning')).toContain('machine learning');
      expect(expandTopics('human compter interaction')).toContain('human computer interaction');
      expect(expandTopics('cyber securty')).toContain('cybersecurity');
    });

    it('does not fuzzy-match short acronym-shaped prose', () => {
      expect(expandTopics('am i in a class')).toHaveLength(0);
      expect(expandTopics('this is a test')).toHaveLength(0);
    });

    it('handles empty query', () => {
      expect(expandTopics('')).toHaveLength(0);
    });
  });
});
