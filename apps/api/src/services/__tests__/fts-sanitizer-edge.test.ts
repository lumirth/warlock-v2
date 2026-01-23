import { describe, it, expect } from 'vitest';
import { sanitizeFtsQuery } from '../search.js';

describe('FTS Sanitizer Edge Cases', () => {
  it('handles word boundaries correctly (should not replace inside words)', () => {
    // "abc#" should not become "abccsharp"
    expect(sanitizeFtsQuery('abc#')).not.toContain('csharp');
    // It should eventually strip the # and result in "abc"
    expect(sanitizeFtsQuery('abc#')).toBe('abc');
  });

  it('handles "C++" correctly (standalone)', () => {
    expect(sanitizeFtsQuery('C++')).toBe('cplusplus');
  });

  it('handles "C++" at start of string', () => {
    expect(sanitizeFtsQuery('C++ is cool')).toContain('cplusplus');
  });

  it('handles "C++" at end of string', () => {
    expect(sanitizeFtsQuery('I like C++')).toContain('cplusplus');
  });

  it('handles overlapping tokens correctly (C++ vs C/C++)', () => {
    // "C/C++" should match the longer token "c/c++" -> "c cplusplus"
    // NOT "C/" + "cplusplus"
    expect(sanitizeFtsQuery('C/C++')).toBe('c cplusplus');
  });

  it('handles .NET correctly (starts with non-word)', () => {
    expect(sanitizeFtsQuery('.NET')).toBe('dotnet');
    expect(sanitizeFtsQuery('using .NET framework')).toContain('dotnet');
  });

  it('does not replace .NET inside a domain like "google.net"', () => {
    const result = sanitizeFtsQuery('google.net');
    // Should NOT become "googledotnet"
    expect(result).not.toContain('dotnet');
    // Should become "google net" after punctuation stripping
    expect(result).toBe('google net');
  });

  it('handles mixed case', () => {
    expect(sanitizeFtsQuery('c++ AND .Net')).toBe('cplusplus AND dotnet');
  });
});
