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
    it('extracts gened:HUM as requirement syntax', () => {
      const result = parseQuery('easy gened:HUM');
      expect(result.clauses[0].filters).toContainEqual({
        field: 'requirement',
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

    it('extracts supported schedule and term fields', () => {
      const result = parseQuery('status:open online:true days:MWF time:morning term:spring-2026 algorithms');
      expect(result.clauses[0].filters).toEqual([
        { field: 'status', value: 'open' },
        { field: 'online', value: 'true' },
        { field: 'days', value: 'MWF' },
        { field: 'time', value: 'morning' },
        { field: 'term', value: 'spring-2026' },
      ]);
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('leaves unsupported fields in residual text', () => {
      const result = parseQuery('unknown:thing algorithms');
      expect(result.clauses[0].filters).toEqual([]);
      expect(result.clauses[0].residual).toBe('unknown:thing algorithms');
    });
  });

  describe('gened:any/all syntax', () => {
    it('extracts gened:any(HUM,US)', () => {
      const result = parseQuery('gened:any(HUM,US) easy');
      expect(result.clauses[0].requirementMode?.any).toEqual(['HUM', 'US']);
      expect(result.clauses[0].residual).toBe('easy');
    });

    it('extracts gened:all(NW,US)', () => {
      const result = parseQuery('gened:all(NW,US)');
      expect(result.clauses[0].requirementMode?.all).toEqual(['NW', 'US']);
    });
  });

  describe('negation syntax', () => {
    it('leaves unsupported dash negation in residual text', () => {
      const result = parseQuery('algorithms -calculus');
      expect(result.clauses[0].negations).toEqual([]);
      expect(result.clauses[0].residual).toBe('algorithms -calculus');
    });

    it('extracts multiple negations', () => {
      const result = parseQuery('-morning -evening');
      expect(result.clauses[0].negations).toContain('morning');
      expect(result.clauses[0].negations).toContain('evening');
    });

    it('extracts -online as an in-person constraint token', () => {
      const result = parseQuery('cs -online');
      expect(result.clauses[0].negations).toContain('online');
      expect(result.clauses[0].residual).toBe('cs');
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
