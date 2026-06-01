import { describe, expect, it } from 'vitest';
import type { Course } from '../../db/index.js';
import type { SearchResult } from '../../services/search.js';
import { buildMatchEvidence, buildResultWarnings, searchResultToCourseDto } from '../course.js';

const course: Course = {
  id: 'CS-225-2026-spring',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data abstractions and algorithms.',
  credit_hours: 4,
  gened: 'QR',
  year: 2026,
  term: 'spring',
  avg_gpa: 3.5,
  gpa_sample_size: 100,
  primary_instructor: 'Lovelace, A',
  primary_instructor_rmp: 4.8,
  difficulty_score: 22,
  quality_score: 91,
  subject_id: 'CS',
  course_info: null,
  degree_attributes: null,
  class_schedule_info: null,
  date_range_text: null,
  registration_notes: null,
  approval_code: null,
  last_synced: 1,
  created_at: 1,
  updated_at: 1,
};

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    course,
    score: 1,
    keywordRank: 1,
    semanticRank: 2,
    historical: false,
    ...overrides,
  };
}

describe('search result DTO evidence', () => {
  it('builds evidence for hard filters, ranking signals, preferences, and metadata', () => {
    const evidence = buildMatchEvidence(searchResult(), {
      rawQuery: 'easy CS 225 QR MWF morning online data structures',
      hints: [{ type: 'instructor', value: 'Lovelace', metadata: { source: 'alias', confidence: 0.8, raw: 'Lovelace' } }],
      plan: {
        filters: {
          subject: 'CS',
          number: '225',
          gened_code: 'QR',
          days: 'MWF',
          time: 'morning',
          online: true,
          difficulty: 'easy',
          term: 'spring',
          year: 2026,
        },
        softPreferences: { levelBoost: 'introductory' },
        keywordQuery: 'data structures',
        semanticQuery: 'data structures',
      },
    });

    expect(evidence.map(item => item.kind)).toEqual(expect.arrayContaining([
      'course_code',
      'title',
      'gened',
      'schedule',
      'delivery',
      'instructor',
      'difficulty',
      'quality',
      'topic',
      'term',
      'keyword',
      'semantic',
    ]));
    expect(evidence.find(item => item.kind === 'course_code')).toMatchObject({ weight: 'hard' });
    expect(evidence.find(item => item.kind === 'semantic')).toMatchObject({ source: 'semantic' });
  });

  it('attaches result evidence and historical warnings to search DTOs', () => {
    const dto = searchResultToCourseDto(searchResult({ historical: true }), {
      rawQuery: 'CS 225',
      hints: [],
      plan: {
        filters: { subject: 'CS', number: '225' },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.match_evidence?.some(item => item.kind === 'course_code')).toBe(true);
    expect(dto.warnings).toEqual([{ kind: 'historical', message: 'Historical term result' }]);
    expect(dto.avg_gpa).toBe(3.5);
    expect(dto.gpa_sample_size).toBe(100);
    expect(dto.primary_instructor_rmp).toBe(4.8);
    expect(dto.quality_score).toBe(91);
    expect(dto.difficulty_score).toBe(22);
  });

  it('keeps warning construction narrow and non-secret', () => {
    expect(buildResultWarnings(searchResult())).toEqual([]);
    expect(buildResultWarnings(searchResult({ historical: true }))[0].message).toBe('Historical term result');
  });
});
