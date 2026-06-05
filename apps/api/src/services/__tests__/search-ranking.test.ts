import { describe, it, expect } from 'vitest';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { singleRequirementFilter } from '@uiuc-course-search/query-types';
import {
  applyRankingPolicy,
  applyTermRankingPolicy,
  buildRetrievalPlan,
  buildSearchCandidateBudget,
  buildTermPriorityMap,
  hybridSearch,
  normalizeSearchControls,
} from '../search.js';
import { fuseRetrievalResults } from '../search-fusion.js';
import type { SearchResult } from '../search.js';
import type { Course } from '../../db/index.js';
import type { SearchPlan } from '../search-planner-types.js';

function course(overrides: Partial<Course>): Course {
  return {
    id: 'CS-100-2026-spring',
    subject: 'CS',
    number: '100',
    title: 'Course',
    description: null,
    credit_hours: 3,
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

async function retrievalPlan(plan: SearchPlan, limit = 20) {
  const controls = normalizeSearchControls();
  const budget = buildSearchCandidateBudget(plan, { limit, offset: 0 }, controls);
  return buildRetrievalPlan(plan, controls, budget);
}

function resultWithTitle(
  id: string,
  title: string,
  score: number,
): SearchResult {
  return {
    course: course({ id, title }),
    score,
  };
}

function applyPolicyForQuery(
  results: SearchResult[],
  query: string,
  plan: Partial<SearchPlan> = {},
): SearchResult[] {
  return applyRankingPolicy(results, {
    filters: {},
    semanticQuery: query,
    keywordQuery: query,
    ...plan,
  }, { query });
}

describe('title-match ranking component', () => {
  it('adds a decisive component for exact title matches', () => {
    const ranked = applyPolicyForQuery([
      resultWithTitle('CS-225', 'Data Structures', 0.5),
      resultWithTitle('CS-374', 'Introduction to Algorithms', 0.6),
    ], 'data structures');

    expect(ranked[0].course.id).toBe('CS-225');
    expect(ranked[0].score).toBeGreaterThan(2.9);
    expect(ranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'title_match', value: 2.5 }),
    ]));
  });

  it('lets exact title matches beat high semantic scores', () => {
    const ranked = applyPolicyForQuery([
      resultWithTitle('CS-225', 'Data Structures', 0.03),
      resultWithTitle('CS-562', 'Advanced Topics in Security, Privacy, and Machine Learning', 0.75),
    ], 'data structures');

    expect(ranked[0].course.id).toBe('CS-225');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('adds a moderate component for partial title matches', () => {
    const ranked = applyPolicyForQuery([
      resultWithTitle('CS-440', 'Artificial Intelligence', 0.5),
      resultWithTitle('CS-101', 'Intro to Computing', 0.55),
    ], 'intelligence');

    expect(ranked[0].course.id).toBe('CS-440');
    expect(ranked[0].score).toBeCloseTo(1.7);
  });

  it('does not add a title component if no title matches', () => {
    const ranked = applyPolicyForQuery([
      resultWithTitle('CS-225', 'Data Structures', 0.5),
    ], 'biology');

    expect(ranked[0].score).toBe(0.5);
    expect(ranked[0].scoreComponents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'title_match' }),
    ]));
  });

  it('adds a smaller component when a long query contains the title', () => {
    const ranked = applyPolicyForQuery([
      resultWithTitle('CS-225', 'Data Structures', 0.5),
      resultWithTitle('CS-101', 'Intro to Computing', 0.55),
    ], 'i need help with data structures class');

    expect(ranked[0].course.id).toBe('CS-225');
    expect(ranked[0].score).toBeCloseTo(0.95);
    expect(ranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'title_match', value: 0.45 }),
    ]));
  });
});

describe('introductory gateway ranking components', () => {
  it('ranks 100-level gateway courses ahead of upper-level Introduction-to-X courses', () => {
    const ranked = applyPolicyForQuery([
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
    ], '', {
      filters: { subject: 'CS' },
      intents: ['introductory_gateway'],
      softPreferences: { levelBoost: 100, introductoryIntent: 'gateway' },
    });

    expect(ranked[0].course.id).toBe('CS-124');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'introductory_gateway' }),
      expect.objectContaining({ name: 'level_accessibility' }),
    ]));
  });

  it('ranks canonical subject gateway numbers ahead of discovery and seminar courses', () => {
    const ranked = applyPolicyForQuery([
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
    ], '', {
      filters: { subject: 'CS' },
      intents: ['introductory_gateway'],
      softPreferences: { levelBoost: 100, introductoryIntent: 'gateway' },
    });

    expect(ranked.map(result => result.course.id)).toEqual(['CS-124', 'CS-107', 'CS-199']);
  });

  it('does not add gateway components for topical intro searches without gateway intent', () => {
    const ranked = applyPolicyForQuery([
      {
        course: course({
          id: 'CS-421',
          number: '421',
          title: 'Programming Languages and Compilers',
        }),
        score: 0.7,
      },
    ], 'intro to compilers', {
      softPreferences: { levelBoost: 100 },
    });

    expect(ranked[0].scoreComponents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'introductory_gateway' }),
    ]));
  });
});

describe('decision-search ranking policy', () => {
  it('matches requested requirements against loaded course_gened codes, not only the flattened course column', () => {
    const reranked = applyRankingPolicy([
      {
        course: course({
          id: 'AAS-281',
          subject: 'AAS',
          number: '281',
          title: 'Constructing Race in America',
        }),
        requirementCodes: ['CS', 'US'],
        score: 0.4,
        laneMatches: ['requirement'],
      },
      {
        course: course({
          id: 'AFST-222',
          subject: 'AFST',
          number: '222',
          title: 'Introduction to Modern Africa',
        }),
        requirementCodes: ['CS'],
        score: 0.7,
        laneMatches: ['requirement'],
      },
    ], {
      filters: { requirement: singleRequirementFilter('US') },
      semanticQuery: 'us minority',
      keywordQuery: 'us minority',
      rescue: {
        queryTypes: ['requirement'],
        negativeTerms: [],
        topicTerms: [],
        expandedTerms: [],
        assumptions: [],
        warnings: [],
        interpretedLanes: ['requirement'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.82,
      },
    });

    expect(reranked[0].course.id).toBe('AAS-281');
    expect(reranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'requirement_match',
        value: 0.9,
        evidence: ['US'],
      }),
    ]));
  });

  it('recognizes requirement credit from loaded codes when the flattened column is empty', () => {
    const reranked = applyRankingPolicy([
      {
        course: course({
          id: 'MACS-150',
          subject: 'MACS',
          number: '150',
          title: 'Introduction to Film',
        }),
        requirementCodes: ['HUM'],
        score: 0.4,
        laneMatches: ['requirement'],
      },
    ], {
      filters: { requirement: singleRequirementFilter('HUM') },
      semanticQuery: 'humanities movies',
      keywordQuery: 'humanities movies',
    });

    expect(reranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'requirement_match',
        value: 0.9,
        evidence: ['HUM'],
      }),
    ]));
  });

  it('prefers evidence-backed low-workload requirement matches over unsupported topical matches', () => {
    const results: SearchResult[] = [
      {
        course: course({
          id: 'FILM-120',
          subject: 'MACS',
          number: '120',
          title: 'Film and Culture',
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
          quality_score: null,
          difficulty_score: null,
          avg_gpa: null,
        }),
        score: 0.8,
        laneMatches: ['topic_semantic'],
      },
    ];

    const reranked = applyRankingPolicy(results, {
      filters: { requirement: singleRequirementFilter('HUM') },
      semanticQuery: 'movies',
      keywordQuery: 'movies',
      rescue: {
        queryTypes: ['requirement', 'topic', 'subjective_vibe', 'avoidance'],
        negativeTerms: ['writing_heavy'],
        topicTerms: ['movies'],
        expandedTerms: ['film cinema media documentary television pop culture visual culture'],
        assumptions: [],
        warnings: [],
        interpretedLanes: ['requirement', 'student_language_alias', 'topic_semantic', 'workload_evidence'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.82,
      },
      softPreferences: { lowWriting: 0.9, lowWorkload: 0.84 },
    });

    expect(reranked[0].course.id).toBe('FILM-120');
    expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
    expect(reranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'requirement_match' }),
      expect.objectContaining({ name: 'workload_evidence' }),
      expect.objectContaining({ name: 'workload_preference' }),
    ]));
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

    const reranked = applyRankingPolicy(results, {
      filters: { subject: 'PHYS', workload: 'easy' },
      semanticQuery: 'physics for non majors',
      keywordQuery: 'physics for non majors',
      softPreferences: { lowWorkload: 0.84, nonMajorFriendly: 0.72 },
    });

    expect(reranked[0].course.id).toBe('PHYS-100');
    expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
    expect(reranked.find(result => result.course.id === 'PHYS-595')?.scoreComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'level_accessibility',
          value: expect.any(Number),
          reason: expect.stringContaining('risk'),
        }),
      ]),
    );
  });
});

describe('explainable ranking policy', () => {
  it('keeps easy science with low-math intent from rewarding math-heavy graduate courses', () => {
    const reranked = applyRankingPolicy([
      {
        course: course({
          id: 'MATH-540',
          subject: 'MATH',
          number: '540',
          title: 'Real Analysis',
          description: 'Graduate treatment of quantitative proof, calculus, and formal logic.',
          quality_score: 82,
          difficulty_score: 20,
          avg_gpa: 3.9,
        }),
        score: 1.4,
        laneMatches: ['official_text'],
      },
      {
        course: course({
          id: 'ASTR-150',
          subject: 'ASTR',
          number: '150',
          title: 'Killer Skies',
          description: 'Introductory science for non-majors.',
          quality_score: 82,
          difficulty_score: 25,
          avg_gpa: 3.65,
        }),
        score: 0.6,
        laneMatches: ['requirement', 'workload_evidence'],
        supportedSubjectiveClaims: ['low_workload', 'low_math'],
      },
    ], {
      filters: {
        requirement: singleRequirementFilter('NAT'),
        workload: 'easy',
        not: { subjects: ['MATH'] },
      },
      semanticQuery: 'easy science but no math',
      keywordQuery: 'easy science but no math',
      softPreferences: { lowMath: 0.86, lowWorkload: 0.84 },
      rescue: {
        queryTypes: ['requirement', 'subjective_vibe', 'avoidance'],
        negativeTerms: ['math_heavy'],
        topicTerms: ['science'],
        expandedTerms: ['natural science'],
        assumptions: [],
        warnings: [],
        interpretedLanes: ['requirement', 'workload_evidence', 'official_text'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.78,
      },
    });

    expect(reranked[0].course.id).toBe('ASTR-150');
    expect(reranked.find(result => result.course.id === 'MATH-540')?.scoreComponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'negative_preference_penalty' }),
        expect.objectContaining({ name: 'level_accessibility', value: -1.25 }),
      ]),
    );
  });

  it('prefers accessible non-major courses over graduate seminars under non-major-friendly intent', () => {
    const reranked = applyRankingPolicy([
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
          quality_score: 76,
        }),
        score: 0.6,
        laneMatches: ['student_language_alias'],
      },
    ], {
      filters: { subject: 'PHYS', workload: 'easy' },
      semanticQuery: 'physics for non majors',
      keywordQuery: 'physics for non majors',
      softPreferences: { lowWorkload: 0.84, nonMajorFriendly: 0.72 },
    });

    expect(reranked.map(result => result.course.id)).toEqual(['PHYS-100', 'PHYS-595']);
    expect(reranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'student_language' }),
      expect.objectContaining({ name: 'level_accessibility', value: 0.55 }),
    ]));
  });

  it('records term ordering as a named tie-break component', () => {
    const ranked = applyTermRankingPolicy([
      {
        course: course({
          id: 'CS-225-2025-fall',
          number: '225',
          term: 'fall',
          year: 2025,
        }),
        score: 10,
      },
      {
        course: course({
          id: 'CS-225-2026-spring',
          number: '225',
          term: 'spring',
          year: 2026,
        }),
        score: 1,
      },
    ], {
      termStates: [
        { term_id: '2026-spring', year: 2026, term: 'spring', status: 'registrable' },
      ],
      limit: 10,
    });

    expect(ranked.map(result => result.course.id)).toEqual([
      'CS-225-2026-spring',
      'CS-225-2025-fall',
    ]);
    expect(ranked[0].scoreComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'term_tie_breaker' }),
    ]));
  });
});

describe('retrieval fusion evidence', () => {
  it('keeps lane evidence separate from ranking policy components', () => {
    const fused = fuseRetrievalResults({
      isNavigational: false,
      courseKeywordResults: [{
        id: 'CS-225',
        lane: 'official_text',
        rank: 1,
        rawScore: -2,
        matchedTerms: ['data structures'],
        reason: 'Official course text FTS recall.',
      }],
      sectionKeywordResults: [],
      requirementResults: [],
      structuredSectionResults: [],
      aliasResults: [],
      semanticResults: [{
        id: 'CS-225',
        lane: 'topic_semantic',
        rank: 3,
        rawScore: 0.89,
        matchedTerms: ['data structures'],
        reason: 'Semantic topic recall.',
      }],
      workloadResults: [],
    });

    expect(fused[0]).toEqual(expect.objectContaining({
      id: 'CS-225',
      laneMatches: ['official_text', 'topic_semantic'],
    }));
    expect(fused[0].laneResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ lane: 'official_text', reason: 'Official course text FTS recall.' }),
      expect.objectContaining({ lane: 'topic_semantic', reason: 'Semantic topic recall.' }),
    ]));
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

    const plan: SearchPlan = {
      filters: {},
      keywordQuery: '',
      semanticQuery: '',
    };
    const results = await hybridSearch(
      db,
      {} as VectorizeIndex,
      {} as Ai,
      await retrievalPlan(plan, 120),
    );

    expect(results).toHaveLength(120);
    expect(Math.max(...bindCounts)).toBe(50);
  });
});
