import { describe, expect, it } from 'vitest';
import type { Course } from '../../db/index.js';
import type { SearchResult } from '../search-types.js';
import {
  applySearchControls,
  normalizeSearchControls,
} from '../search-controls.js';

const course = (overrides: Partial<Course>): Course => ({
  id: 'COURSE-1',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: null,
  credit_hours: 4,
  year: 2026,
  term: 'spring',
  avg_gpa: null,
  gpa_sample_size: null,
  primary_instructor: null,
  primary_instructor_rmp: null,
  difficulty_score: null,
  quality_score: null,
  subject_id: 'CS',
  course_info: null,
  degree_attributes: null,
  class_schedule_info: null,
  date_range_text: null,
  registration_notes: null,
  approval_code: null,
  last_synced: 0,
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

const result = (
  id: string,
  overrides: Partial<Course> = {},
  searchOverrides: Partial<SearchResult> = {},
): SearchResult => ({
  course: course({ id, ...overrides }),
  score: searchOverrides.score ?? 1,
  historical: searchOverrides.historical,
  scoreComponents: searchOverrides.scoreComponents,
});

describe('applySearchControls', () => {
  it('keeps relevance order as the default sort', () => {
    const results = [
      result('first', { avg_gpa: 2.9 }),
      result('second', { avg_gpa: 4.0 }),
    ];

    expect(applySearchControls(results).map((item) => item.course.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('sorts precise numeric attributes server-side with nulls last', () => {
    const sorted = applySearchControls(
      [
        result('middle', { avg_gpa: 3.4 }),
        result('missing', { avg_gpa: null }),
        result('best', { avg_gpa: 3.9 }),
      ],
      { sort: { field: 'gpa', direction: 'desc' }, scope: 'all' },
    );

    expect(sorted.map((item) => item.course.id)).toEqual([
      'best',
      'middle',
      'missing',
    ]);
    expect(sorted[0].score).toBe(1);
    expect(sorted[0].scoreComponents).toEqual([
      expect.objectContaining({
        name: 'attribute_sort',
        value: 0,
        reason: 'Sorted by Avg GPA (descending); relevance breaks ties.',
        evidence: ['Avg GPA: 3.90.'],
      }),
    ]);
    expect(sorted[2].scoreComponents).toEqual([
      expect.objectContaining({
        name: 'attribute_sort',
        value: 0,
        evidence: ['Avg GPA unavailable; sorted after courses with data.'],
      }),
    ]);
  });

  it('uses relevance order as the tiebreaker for equal sort values', () => {
    const sorted = applySearchControls(
      [
        result('relevance-first', { primary_instructor_rmp: 4.7 }),
        result('relevance-second', { primary_instructor_rmp: 4.7 }),
      ],
      {
        sort: { field: 'instructor_rating', direction: 'desc' },
        scope: 'all',
      },
    );

    expect(sorted.map((item) => item.course.id)).toEqual([
      'relevance-first',
      'relevance-second',
    ]);
    expect(sorted.map(item => item.scoreComponents?.[0]?.name)).toEqual([
      'attribute_sort',
      'attribute_sort',
    ]);
  });

  it('sorts quality by displayed tier, not raw composite score', () => {
    const sorted = applySearchControls(
      [
        result('excellent-relevance-first', { quality_score: 86 }),
        result('excellent-higher-raw-score', { quality_score: 99 }),
        result('good', { quality_score: 80 }),
      ],
      { sort: { field: 'quality', direction: 'desc' }, scope: 'all' },
    );

    expect(sorted.map((item) => item.course.id)).toEqual([
      'excellent-relevance-first',
      'excellent-higher-raw-score',
      'good',
    ]);
  });

  it('sorts workload by displayed tier, not raw difficulty score', () => {
    const sorted = applySearchControls(
      [
        result('easy-relevance-first', { difficulty_score: 20 }),
        result('hard', { difficulty_score: 90 }),
        result('easy-lower-raw-score', { difficulty_score: 5 }),
        result('moderate', { difficulty_score: 55 }),
      ],
      { sort: { field: 'workload', direction: 'asc' }, scope: 'all' },
    );

    expect(sorted.map((item) => item.course.id)).toEqual([
      'easy-relevance-first',
      'easy-lower-raw-score',
      'moderate',
      'hard',
    ]);
  });

  it('filters historical results out of active scope', () => {
    const scoped = applySearchControls(
      [
        result('active', {}, { historical: false }),
        result('historical', {}, { historical: true }),
      ],
      { scope: 'active' },
    );

    expect(scoped.map((item) => item.course.id)).toEqual(['active']);
  });

  it('keeps explicitly requested historical terms even under the default active scope', () => {
    const scoped = applySearchControls(
      [
        result('active', {}, { historical: false }),
        result('requested-spring', {}, { historical: true }),
      ],
      { scope: 'active' },
      { hasExplicitTermFilter: true },
    );

    expect(scoped.map((item) => item.course.id)).toEqual([
      'active',
      'requested-spring',
    ]);
  });

  it('orders level by numeric course number', () => {
    const sorted = applySearchControls(
      [
        result('senior', { number: '498' }),
        result('gateway', { number: '124' }),
        result('grad', { number: '598' }),
      ],
      { sort: { field: 'level', direction: 'asc' }, scope: 'all' },
    );

    expect(sorted.map((item) => item.course.id)).toEqual([
      'gateway',
      'senior',
      'grad',
    ]);
  });

  it('replaces stale sort trace components when controls are reapplied', () => {
    const firstPass = applySearchControls(
      [result('course', { avg_gpa: 3.9, credit_hours: 4 })],
      { sort: { field: 'gpa', direction: 'desc' }, scope: 'all' },
    );
    const secondPass = applySearchControls(
      firstPass,
      { sort: { field: 'credits', direction: 'asc' }, scope: 'all' },
    );

    expect(secondPass[0].scoreComponents).toEqual([
      expect.objectContaining({
        name: 'attribute_sort',
        reason: 'Sorted by Credits (ascending); relevance breaks ties.',
        evidence: ['Credits: 4.'],
      }),
    ]);
  });
});

describe('normalizeSearchControls', () => {
  it('uses per-field default directions', () => {
    expect(normalizeSearchControls({ sort: { field: 'gpa' } }).sort).toEqual({
      field: 'gpa',
      direction: 'desc',
    });
    expect(
      normalizeSearchControls({ sort: { field: 'workload' } }).sort,
    ).toEqual({
      field: 'workload',
      direction: 'asc',
    });
  });
});
