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
});
