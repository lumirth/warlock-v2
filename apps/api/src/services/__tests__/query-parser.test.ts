import { describe, it, expect } from 'vitest';
import { parseQuery } from '../query-parser.js';

describe('parseQuery', () => {
  describe('basic queries', () => {
    it('returns residual for plain text', () => {
      const result = parseQuery('data structures');
      expect(result.clauses).toHaveLength(1);
      expect(result.clauses[0].residual).toBe('data structures');
      expect(result.clauses[0].filters).toEqual([]);
      expect(result.clauses[0].negations).toEqual([]);
      expect(result.clauses[0].phrases).toEqual([]);
    });
  });

  describe('field:value syntax', () => {
    it('extracts gened:HUM', () => {
      const result = parseQuery('easy gened:HUM');
      expect(result.clauses[0].filters).toContainEqual({
        field: 'gened',
        value: 'HUM',
      });
      expect(result.clauses[0].residual).toBe('easy');
    });

    it('extracts subject:CS', () => {
      const result = parseQuery('subject:CS algorithms');
      expect(result.clauses[0].filters).toContainEqual({
        field: 'subject',
        value: 'CS',
      });
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('extracts multiple field:value pairs', () => {
      const result = parseQuery('gened:HUM difficulty:easy');
      expect(result.clauses[0].filters).toHaveLength(2);
    });
  });

  describe('gened:any/all syntax', () => {
    it('extracts gened:any(HUM,US)', () => {
      const result = parseQuery('gened:any(HUM,US) easy');
      expect(result.clauses[0].genedMode?.any).toEqual(['HUM', 'US']);
      expect(result.clauses[0].residual).toBe('easy');
    });

    it('extracts gened:all(NW,US)', () => {
      const result = parseQuery('gened:all(NW,US)');
      expect(result.clauses[0].genedMode?.all).toEqual(['NW', 'US']);
    });
  });

  describe('negation syntax', () => {
    it('extracts -term as negation', () => {
      const result = parseQuery('algorithms -calculus');
      expect(result.clauses[0].negations).toContain('calculus');
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('extracts multiple negations', () => {
      const result = parseQuery('-morning -evening');
      expect(result.clauses[0].negations).toContain('morning');
      expect(result.clauses[0].negations).toContain('evening');
    });
  });

  describe('phrase syntax', () => {
    it('extracts "quoted phrase"', () => {
      const result = parseQuery('"data structures" algorithms');
      expect(result.clauses[0].phrases).toContain('data structures');
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('extracts multiple phrases', () => {
      const result = parseQuery('"intro to" "computer science"');
      expect(result.clauses[0].phrases).toContain('intro to');
      expect(result.clauses[0].phrases).toContain('computer science');
    });
  });
});
