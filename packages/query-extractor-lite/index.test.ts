import { describe, it, expect } from 'vitest';
import { extractQueryLite } from './index.js';

describe('extractQueryLite', () => {
  it('extracts gened patterns', () => {
    const result = extractQueryLite('easy gened humanities');
    expect(result.hints).toContainEqual(expect.objectContaining({ type: 'gened', value: 'humanities' }));
    expect(result.residual).toBe('easy');
  });

  it('extracts "by instructor" pattern', () => {
    const result = extractQueryLite('cs 225 by fagen');
    expect(result.hints).toContainEqual(expect.objectContaining({ type: 'instructor', value: 'fagen' }));
  });
});
