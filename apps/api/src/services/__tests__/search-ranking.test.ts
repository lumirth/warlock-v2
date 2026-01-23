import { describe, it, expect } from 'vitest';
import { applyTitleBoost } from '../search.js'; // You'll export this

describe('exact-title boost', () => {
  it('boosts exact title matches significantly', () => {
    const scores = [
      { id: 'CS-225', score: 0.5, title: 'Data Structures' },
      { id: 'CS-374', score: 0.6, title: 'Introduction to Algorithms' },
    ];

    const boosted = applyTitleBoost(scores, 'data structures');

    // CS-225 should now be ranked higher due to title match
    // 0.5 + 0.5 = 1.0 > 0.6
    expect(boosted[0].id).toBe('CS-225');
    expect(boosted[0].score).toBeGreaterThan(0.9);
  });

  it('boosts partial title matches moderately', () => {
    const scores = [
      { id: 'CS-440', score: 0.5, title: 'Artificial Intelligence' },
      { id: 'CS-101', score: 0.55, title: 'Intro to Computing' },
    ];

    const boosted = applyTitleBoost(scores, 'intelligence');

    // CS-440 should get a boost (0.2) -> 0.7 > 0.55
    expect(boosted[0].id).toBe('CS-440');
    expect(boosted[0].score).toBeCloseTo(0.7);
  });

  it('does nothing if no match', () => {
    const scores = [
      { id: 'CS-225', score: 0.5, title: 'Data Structures' },
    ];
    const boosted = applyTitleBoost(scores, 'biology');
    expect(boosted[0].score).toBe(0.5);
  });

  it('boosts when query contains title (long natural language query)', () => {
    const scores = [
      { id: 'CS-225', score: 0.5, title: 'Data Structures' },
      { id: 'CS-101', score: 0.55, title: 'Intro to Computing' },
    ];

    // "data structures" is in the query, so it should get a smaller boost (0.15)
    const boosted = applyTitleBoost(scores, 'i need help with data structures class');

    // CS-225: 0.5 + 0.15 = 0.65
    // CS-101: 0.55 (no change)
    expect(boosted[0].id).toBe('CS-225');
    expect(boosted[0].score).toBeCloseTo(0.65);
  });
});
