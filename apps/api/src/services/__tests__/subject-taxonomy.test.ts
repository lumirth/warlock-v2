import { describe, expect, it } from 'vitest';
import {
  generatedSubjectAliases,
  isKnownSubjectCode,
  isSafeStandaloneSubjectToken,
  subjectName,
} from '../subject-taxonomy.js';

describe('subject taxonomy', () => {
  it('recognizes official subject codes and names from the generated subject snapshot', () => {
    expect(isKnownSubjectCode('cs')).toBe(true);
    expect(isKnownSubjectCode('NOTREAL')).toBe(false);
    expect(subjectName('CS')).toBe('Computer Science');
  });

  it('keeps unsafe common words from matching as lowercase standalone subject tokens', () => {
    expect(isSafeStandaloneSubjectToken('CS')).toBe(true);
    expect(isSafeStandaloneSubjectToken('cs')).toBe(true);
    expect(isSafeStandaloneSubjectToken('IS')).toBe(true);
    expect(isSafeStandaloneSubjectToken('is')).toBe(false);
  });

  it('exposes generated subject aliases to the alias registry without exposing raw data owners', () => {
    const csAliases = generatedSubjectAliases().find(entry => entry.subject === 'CS');
    expect(csAliases?.aliases).toEqual(expect.arrayContaining(['computer science']));
  });
});
