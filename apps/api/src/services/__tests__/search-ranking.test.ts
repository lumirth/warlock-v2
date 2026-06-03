import { describe, it, expect } from 'vitest';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { applySearchIntentBoosts, applyTitleBoost, applyUsefulnessRerank, buildTermPriorityMap, hybridSearch } from '../search.js';
import type { SearchResult } from '../search.js';
import type { Course } from '../../db/index.js';

function course(overrides: Partial<Course>): Course {
  return {
    id: 'CS-100-2026-spring',
    subject: 'CS',
    number: '100',
    title: 'Course',
    description: null,
    credit_hours: 3,
    gened: null,
    year: 2026,
    term: 'spring',
    avg_gpa: null,
    gpa_sample_size: null,
    primary_instructor: null,
    primary_instructor_rmp: null,
    quality_score: null,
    difficulty_score: null,
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
  };
}

describe('exact-title boost', () => {
  it('boosts exact title matches significantly', () => {
    const scores = [
      { id: 'CS-225', score: 0.5, title: 'Data Structures' },
      { id: 'CS-374', score: 0.6, title: 'Introduction to Algorithms' },
    ];

    const boosted = applyTitleBoost(scores, 'data structures');

    // CS-225 should now be ranked higher due to a decisive exact-title match.
    expect(boosted[0].id).toBe('CS-225');
    expect(boosted[0].score).toBeGreaterThan(2.9);
  });

  it('lets exact title matches beat high semantic scores', () => {
    const scores = [
      { id: 'CS-225', score: 0.03, title: 'Data Structures' },
      { id: 'CS-562', score: 0.75, title: 'Advanced Topics in Security, Privacy, and Machine Learning' },
    ];

    const boosted = applyTitleBoost(scores, 'data structures');

    expect(boosted[0].id).toBe('CS-225');
    expect(boosted[0].score).toBeGreaterThan(boosted[1].score);
  });

  it('boosts partial title matches moderately', () => {
    const scores = [
      { id: 'CS-440', score: 0.5, title: 'Artificial Intelligence' },
      { id: 'CS-101', score: 0.55, title: 'Intro to Computing' },
    ];

    const boosted = applyTitleBoost(scores, 'intelligence');

    // CS-440 should get a meaningful title-contained boost.
    expect(boosted[0].id).toBe('CS-440');
    expect(boosted[0].score).toBeCloseTo(1.7);
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

    // "data structures" is in the query, so it should get a smaller boost.
    const boosted = applyTitleBoost(scores, 'i need help with data structures class');

    // CS-225: 0.5 + 0.45 = 0.95
    // CS-101: 0.55 (no change)
    expect(boosted[0].id).toBe('CS-225');
    expect(boosted[0].score).toBeCloseTo(0.95);
  });
});

describe('introductory gateway intent boost', () => {
  it('ranks 100-level gateway courses ahead of upper-level Introduction-to-X courses', () => {
    const results: SearchResult[] = [
      {
        course: course({
          id: 'CS-340',
          number: '340',
          title: 'Introduction to Computer Systems',
          credit_hours: 4,
        }),
        score: 0.9,
      },
      {
        course: course({
          id: 'CS-124',
          number: '124',
          title: 'Introduction to Computer Science I',
          credit_hours: 3,
        }),
        score: 0.4,
      },
    ];

    const boosted = applySearchIntentBoosts(results, {
      filters: { subject: 'CS' },
      semanticQuery: '',
      keywordQuery: '',
      intents: ['introductory_gateway'],
      softPreferences: { levelBoost: 100, introductoryIntent: 'gateway' },
    }).sort((a, b) => b.score - a.score);

    expect(boosted[0].course.id).toBe('CS-124');
    expect(boosted[0].score).toBeGreaterThan(boosted[1].score);
  });

  it('ranks canonical subject gateway numbers ahead of discovery and seminar courses', () => {
    const results: SearchResult[] = [
      {
        course: course({
          id: 'CS-107',
          number: '107',
          title: 'Data Science Discovery',
        }),
        score: 1.5,
      },
      {
        course: course({
          id: 'CS-199',
          number: '199',
          title: 'Undergraduate Open Seminar in Computer Science',
        }),
        score: 1.4,
      },
      {
        course: course({
          id: 'CS-124',
          number: '124',
          title: 'Introduction to Computer Science I',
        }),
        score: 0.7,
      },
    ];

    const boosted = applySearchIntentBoosts(results, {
      filters: { subject: 'CS' },
      semanticQuery: '',
      keywordQuery: '',
      intents: ['introductory_gateway'],
      softPreferences: { levelBoost: 100, introductoryIntent: 'gateway' },
    }).sort((a, b) => b.score - a.score);

    expect(boosted.map(result => result.course.id)).toEqual(['CS-124', 'CS-107', 'CS-199']);
  });

  it('does not change topical intro searches without gateway intent', () => {
    const results: SearchResult[] = [
      {
        course: course({
          id: 'CS-421',
          number: '421',
          title: 'Programming Languages and Compilers',
        }),
        score: 0.7,
      },
    ];

    expect(applySearchIntentBoosts(results, {
      filters: {},
      semanticQuery: 'intro to compilers',
      keywordQuery: 'intro to compilers',
      softPreferences: { levelBoost: 100 },
    })).toEqual(results);
  });
});

describe('decision-search usefulness reranking', () => {
  it('prefers evidence-backed low-workload requirement matches over unsupported topical matches', () => {
    const results: SearchResult[] = [
      {
        course: course({
          id: 'FILM-120',
          subject: 'MACS',
          number: '120',
          title: 'Film and Culture',
          gened: 'HUM',
          quality_score: 82,
          difficulty_score: 28,
          avg_gpa: 3.72,
        }),
        score: 0.5,
        laneMatches: ['requirement', 'student_language_alias', 'workload_evidence'],
        supportedSubjectiveClaims: ['low_workload', 'low_writing'],
      },
      {
        course: course({
          id: 'MACS-420',
          subject: 'MACS',
          number: '420',
          title: 'Advanced Film Theory',
          gened: null,
          quality_score: null,
          difficulty_score: null,
          avg_gpa: null,
        }),
        score: 0.8,
        laneMatches: ['topic_semantic'],
      },
    ];

    const reranked = applyUsefulnessRerank(results, {
      filters: { gened_code: 'HUM' },
      semanticQuery: 'movies',
      keywordQuery: 'movies',
      rescue: {
        queryTypes: ['requirement', 'topic', 'subjective_vibe', 'avoidance'],
        negativeTerms: ['writing_heavy'],
        topicTerms: ['movies'],
        expandedTerms: ['film cinema media documentary television pop culture visual culture'],
        assumptions: [],
        warnings: [],
        retrievalLanes: ['requirement', 'student_language_alias', 'topic_semantic', 'workload_evidence'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.82,
      },
      softPreferences: { lowWriting: 0.9, lowWorkload: 0.84 },
    });

    expect(reranked[0].course.id).toBe('FILM-120');
    expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
  });

  it('penalizes graduate seminars for easy/non-major-friendly workload intent', () => {
    const results: SearchResult[] = [
      {
        course: course({
          id: 'PHYS-595',
          subject: 'PHYS',
          number: '595',
          title: 'Advanced Topics in Physics',
          avg_gpa: 3.95,
          difficulty_score: 20,
        }),
        score: 1.1,
      },
      {
        course: course({
          id: 'PHYS-100',
          subject: 'PHYS',
          number: '100',
          title: 'Thinking About Physics',
          avg_gpa: 3.45,
          difficulty_score: 34,
        }),
        score: 0.6,
        laneMatches: ['student_language_alias'],
      },
    ];

    const reranked = applyUsefulnessRerank(results, {
      filters: { subject: 'PHYS', difficulty: 'easy' },
      semanticQuery: 'physics for non majors',
      keywordQuery: 'physics for non majors',
      softPreferences: { lowWorkload: 0.84, nonMajorFriendly: 0.72 },
    });

    expect(reranked[0].course.id).toBe('PHYS-100');
    expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
  });
});

describe('term priority', () => {
  it('prioritizes registrable regular semesters over simultaneous winter and summer terms', () => {
    const priorities = buildTermPriorityMap([
      { term_id: '2026-winter', year: 2026, term: 'winter', status: 'registrable' },
      { term_id: '2026-spring', year: 2026, term: 'spring', status: 'registrable' },
      { term_id: '2026-summer', year: 2026, term: 'summer', status: 'registrable' },
      { term_id: '2026-fall', year: 2026, term: 'fall', status: 'registrable' },
      { term_id: '2027-spring', year: 2027, term: 'spring', status: 'active' },
    ]);

    expect(priorities.get('2026-fall')).toBeLessThan(priorities.get('2026-summer')!);
    expect(priorities.get('2026-spring')).toBeLessThan(priorities.get('2026-winter')!);
    expect(priorities.get('2026-summer')).toBeLessThan(priorities.get('2027-spring')!);
  });

  it('does not let an older registrable regular semester outrank a newer registrable winter or summer term', () => {
    const priorities = buildTermPriorityMap([
      { term_id: '2026-fall', year: 2026, term: 'fall', status: 'registrable' },
      { term_id: '2027-winter', year: 2027, term: 'winter', status: 'registrable' },
      { term_id: '2027-summer', year: 2027, term: 'summer', status: 'registrable' },
    ]);

    expect(priorities.get('2027-summer')).toBeLessThan(priorities.get('2026-fall')!);
    expect(priorities.get('2027-winter')).toBeLessThan(priorities.get('2026-fall')!);
  });
});

describe('search SQL batching', () => {
  it('chunks large course metadata fetches for deep pagination windows', async () => {
    const bindCounts: number[] = [];
    const courses = Array.from({ length: 120 }, (_, index) => course({
      id: `CS-${String(index).padStart(3, '0')}-2026-fall`,
      number: String(index).padStart(3, '0'),
      title: `Course ${index}`,
      term: 'fall',
    }));
    const courseById = new Map(courses.map(item => [item.id, item]));
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          all: async () => {
            bindCounts.push(params.length);
            if (params.length > 50) {
              throw new Error(`too many SQL variables in test: ${params.length}`);
            }

            if (sql.includes('SELECT id, quality_score FROM courses')) {
              return { results: params.map(id => ({ id, quality_score: null })) };
            }

            if (sql.includes('FROM courses c') && sql.includes('WHERE c.id IN')) {
              return { results: params.map(id => courseById.get(String(id))).filter(Boolean) };
            }

            if (sql.includes('SELECT DISTINCT c.id')) {
              return { results: courses.map((item, index) => ({ id: item.id, fts_score: index })) };
            }

            return { results: [] };
          },
        }),
      }),
    } as unknown as D1Database;

    const results = await hybridSearch(db, {} as VectorizeIndex, {} as Ai, {
      filters: {},
      keywordQuery: '',
      semanticQuery: '',
    }, 120);

    expect(results).toHaveLength(120);
    expect(Math.max(...bindCounts)).toBe(50);
  });
});
