import { describe, it, expect } from 'vitest';

describe('Search Integration', () => {
  it('"CS 225" query returns CS 225 as top result', async () => {
    // This is a smoke test that verifies the full pipeline
    // Run against actual deployed API or local dev server

    const response = await fetch('http://localhost:8787/api/search?q=CS%20225');
    const data = await response.json();

    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);

    const topResult = data.results[0];
    expect(topResult.subject).toBe('CS');
    expect(topResult.number).toBe('225');
  });

  it('"MATH 241" query returns MATH 241 as top result', async () => {
    const response = await fetch('http://localhost:8787/api/search?q=MATH%20241');
    const data = await response.json();

    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);

    const topResult = data.results[0];
    expect(topResult.subject).toBe('MATH');
    expect(topResult.number).toBe('241');
  });
});
