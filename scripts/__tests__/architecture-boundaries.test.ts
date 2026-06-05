import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('architecture boundaries', () => {
  it('keeps the search route as an adapter instead of a public response presenter', () => {
    const source = readFileSync('apps/api/src/routes/search.ts', 'utf8');

    expect(source).toContain('presentSearchResponse');
    expect(source).not.toMatch(/SearchResponseDto|SearchInterpretationDto|SearchPlan/);
    expect(source).not.toContain('../dto/course');
    expect(source).not.toContain('../dto/search-geneds');
    expect(source).not.toContain('../services/search-ui-plan');
    expect(source).not.toContain('../services/term-state');
  });
});
