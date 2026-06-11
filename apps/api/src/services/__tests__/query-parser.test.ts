import { describe, it, expect } from 'vitest';
import { parseQuery } from '../query-parser.js';

describe('parseQuery', () => {
  describe('basic queries', () => {
    it('returns residual for plain text', () => {
      const result = parseQuery('data structures');
      expect(result.residual).toBe('data structures');
      expect(result.filters).toEqual([]);
      expect(result.negations).toEqual([]);
      expect(result.phrases).toEqual([]);
    });
  });

  describe('field:value syntax', () => {
    it('extracts gened:HUM as requirement syntax', () => {
      const result = parseQuery('easy gened:HUM');
      expect(result.filters).toContainEqual({
        field: 'requirement',
        value: 'HUM',
      });
      expect(result.residual).toBe('easy');
    });

    it('extracts subject:CS', () => {
      const result = parseQuery('subject:CS algorithms');
      expect(result.filters).toContainEqual({
        field: 'subject',
        value: 'CS',
      });
      expect(result.residual).toBe('algorithms');
    });

    it('extracts multiple field:value pairs', () => {
      const result = parseQuery('gened:HUM difficulty:easy');
      expect(result.filters).toHaveLength(2);
    });

    it('extracts supported schedule and term fields', () => {
      const result = parseQuery('status:open online:true days:MWF time:morning term:spring-2026 algorithms');
      expect(result.filters).toEqual([
        { field: 'status', value: 'open' },
        { field: 'online', value: 'true' },
        { field: 'days', value: 'MWF' },
        { field: 'time', value: 'morning' },
        { field: 'term', value: 'spring-2026' },
      ]);
      expect(result.residual).toBe('algorithms');
    });

    it('normalizes forgiving part-of-term aliases at the parser boundary', () => {
      const result = parseQuery('pot:A part_of_term:B');

      expect(result.filters).toEqual([
        { field: 'partofterm', value: 'A' },
        { field: 'partofterm', value: 'B' },
      ]);
      expect(result.residual).toBe('');
    });

    it('leaves unsupported fields in residual text', () => {
      const result = parseQuery('unknown:thing algorithms');
      expect(result.filters).toEqual([]);
      expect(result.residual).toBe('unknown:thing algorithms');
    });

    it('leaves malformed supported fields in residual text', () => {
      const result = parseQuery('level:999 status:maybe subject:computer algorithms');
      expect(result.filters).toEqual([]);
      expect(result.residual).toBe(
        'level:999 status:maybe subject:computer algorithms',
      );
    });
  });

  describe('gened:any/all syntax', () => {
    it('extracts gened:any(HUM,US)', () => {
      const result = parseQuery('gened:any(HUM,US) easy');
      expect(result.requirementMode?.any).toEqual(['HUM', 'US']);
      expect(result.residual).toBe('easy');
    });

    it('extracts gened:all(NW,US)', () => {
      const result = parseQuery('gened:all(NW,US)');
      expect(result.requirementMode?.all).toEqual(['NW', 'US']);
    });

    it('keeps invalid requirement modes visible in residual text', () => {
      const result = parseQuery('gened:any(HUM,NOPE) easy');
      expect(result.requirementMode).toBeUndefined();
      expect(result.residual).toBe('gened:any(HUM,NOPE) easy');
    });
  });

  describe('negation syntax', () => {
    it('leaves unsupported dash negation in residual text', () => {
      const result = parseQuery('algorithms -calculus');
      expect(result.negations).toEqual([]);
      expect(result.residual).toBe('algorithms -calculus');
    });

    it('extracts multiple negations', () => {
      const result = parseQuery('-morning -evening');
      expect(result.negations).toContain('morning');
      expect(result.negations).toContain('evening');
    });

    it('extracts -online as an in-person constraint token', () => {
      const result = parseQuery('cs -online');
      expect(result.negations).toContain('online');
      expect(result.residual).toBe('cs');
    });
  });

  describe('phrase syntax', () => {
    it('extracts "quoted phrase"', () => {
      const result = parseQuery('"data structures" algorithms');
      expect(result.phrases).toContain('data structures');
      expect(result.residual).toBe('algorithms');
    });

    it('extracts multiple phrases', () => {
      const result = parseQuery('"intro to" "computer science"');
      expect(result.phrases).toContain('intro to');
      expect(result.phrases).toContain('computer science');
    });
  });
});
