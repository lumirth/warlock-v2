import { describe, it, expect } from 'vitest';
import { sanitizeFtsQuery } from '../search.js';

describe('sanitizeFtsQuery', () => {
  it('replaces & with " and "', () => {
    expect(sanitizeFtsQuery('data & algorithms')).toBe('data and algorithms');
    expect(sanitizeFtsQuery('CS & Math')).toBe('CS and Math');
  });

  it('removes special characters that break FTS5', () => {
    expect(sanitizeFtsQuery('search | query')).toBe('search query');
    expect(sanitizeFtsQuery('search * query')).toBe('search query');
    expect(sanitizeFtsQuery('search ^ query')).toBe('search query');
    expect(sanitizeFtsQuery('search (query)')).toBe('search query');
    expect(sanitizeFtsQuery('search : query')).toBe('search query');
    expect(sanitizeFtsQuery('search + query')).toBe('search query');
  });

  it('preserves alphanumeric characters and spaces', () => {
    expect(sanitizeFtsQuery('CS 124')).toBe('CS 124');
    expect(sanitizeFtsQuery('Artificial Intelligence')).toBe('Artificial Intelligence');
  });

  it('handles multiple ampersands', () => {
    expect(sanitizeFtsQuery('a & b & c')).toBe('a and b and c');
  });

  it('handles empty strings', () => {
    expect(sanitizeFtsQuery('')).toBe('');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeFtsQuery('word   word')).toBe('word word');
  });

  it('removes apostrophes so contractions cannot break FTS5', () => {
    expect(sanitizeFtsQuery("what's an easy gen ed")).toBe('what s an easy gen ed');
    expect(sanitizeFtsQuery("isn’t writing-heavy")).toBe('isn t writing heavy');
  });

  it('handles leading and trailing whitespace', () => {
    expect(sanitizeFtsQuery('  word  ')).toBe('word');
  });

  it('handles unbalanced quotes by removing them', () => {
    expect(sanitizeFtsQuery('"machine learning')).toBe('machine learning');
    expect(sanitizeFtsQuery('machine "learning')).toBe('machine learning');
    expect(sanitizeFtsQuery('machine learning"')).toBe('machine learning');
  });

  it('preserves balanced double quotes for phrases', () => {
    expect(sanitizeFtsQuery('"machine learning"')).toBe('"machine learning"');
  });

  describe('special token handling', () => {
    it('preserves C++ as cplusplus', () => {
      // Note: FTS5 tokenizers often strip +, #, ., so we replace them with text
      expect(sanitizeFtsQuery('C++ programming')).toContain('cplusplus');
    });

    it('preserves C# as csharp', () => {
      expect(sanitizeFtsQuery('C# development')).toContain('csharp');
    });

    it('preserves .NET as dotnet', () => {
      expect(sanitizeFtsQuery('.NET framework')).toContain('dotnet');
    });

    it('preserves F# as fsharp', () => {
      expect(sanitizeFtsQuery('F#')).toContain('fsharp');
    });

    it('handles "C/C++" correctly', () => {
      const result = sanitizeFtsQuery('C/C++');
      // specific expectation depends on implementation, but should contain cplusplus
      expect(result).toContain('cplusplus');
    });
  });
});
