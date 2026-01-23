import { describe, it, expect } from 'vitest';
import { sanitizeFtsQuery } from '../search.js';

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
