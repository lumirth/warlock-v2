import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';

describe('Part of Term Extraction', () => {
  it('extracts "part of term A" correctly', () => {
    const query = 'CS 225 part of term A';
    const result = extract(query);

    expect(result.hints).toContainEqual(expect.objectContaining({
      type: 'partOfTerm',
      value: 'A'
    }));
    expect(result.residual).not.toContain('part of term A');
  });

  it('extracts "POT B" correctly', () => {
    const query = 'STAT 400 POT B';
    const result = extract(query);

    expect(result.hints).toContainEqual(expect.objectContaining({
      type: 'partOfTerm',
      value: 'B'
    }));
    expect(result.residual).not.toContain('POT B');
  });

  it('extracts "part of term 1" correctly', () => {
    const query = 'MBA 500 part of term 1';
    const result = extract(query);

    expect(result.hints).toContainEqual(expect.objectContaining({
      type: 'partOfTerm',
      value: '1'
    }));
  });

  it('extracts "first half" as POT A', () => {
    const query = 'easy gened first half';
    const result = extract(query);

    expect(result.hints).toContainEqual(expect.objectContaining({
      type: 'partOfTerm',
      value: 'A'
    }));
    expect(result.residual).not.toContain('first half');
  });

  it('extracts "second half" as POT B', () => {
    const query = 'badminton second half';
    const result = extract(query);

    expect(result.hints).toContainEqual(expect.objectContaining({
      type: 'partOfTerm',
      value: 'B'
    }));
    expect(result.residual).not.toContain('second half');
  });

  it('handles case insensitivity', () => {
    const query = 'pot b';
    const result = extract(query);

    expect(result.hints).toContainEqual(expect.objectContaining({
      type: 'partOfTerm',
      value: 'B'
    }));
  });
});
