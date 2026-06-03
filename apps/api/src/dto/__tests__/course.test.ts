import { describe, expect, it } from 'vitest';
import type { Course } from '../../db/index.js';
import type { SearchResult } from '../../services/search.js';
import { buildMatchEvidence, buildResultWarnings, searchResultToCourseDto, toCourseDto, toInstructorLinkDto } from '../course.js';

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
    expect(evidence.find(item => item.kind === 'difficulty')?.label).toBe('Easier workload fit');
    expect(evidence.find(item => item.kind === 'quality')?.label).toBe('Excellent course quality');
    expect(evidence.find(item => item.kind === 'semantic')).toMatchObject({ source: 'semantic' });
    expect(evidence.find(item => item.kind === 'keyword')?.label).toBe('Strong keyword match');
    expect(evidence.find(item => item.kind === 'semantic')?.label).toBe('Related topic match');
    expect(evidence.map(item => item.label).join(' ')).not.toContain('rank #');
    expect(evidence.map(item => item.label).join(' ')).not.toMatch(/Quality \d/);
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
    expect(dto.course_explorer_url).toBe('https://courses.illinois.edu/schedule/2026/spring/CS/225');
  });

  it('explains subjective decision matches with evidence and uncertainty', () => {
    const dto = searchResultToCourseDto(searchResult({
      laneMatches: ['requirement', 'student_language_alias'],
      supportedSubjectiveClaims: [],
    }), {
      rawQuery: 'easy online gen ed no essays',
      hints: [],
      plan: {
        filters: { gened_code: 'QR', online: true },
        keywordQuery: '',
        semanticQuery: '',
        rescue: {
          queryTypes: ['requirement', 'schedule', 'subjective_vibe', 'avoidance'],
          negativeTerms: ['writing_heavy', 'essays', 'papers'],
          topicTerms: [],
          expandedTerms: [],
          assumptions: [
            { kind: 'online_preferred', label: 'Online preferred', confidence: 0.86, source: 'rule' },
            { kind: 'low_writing', label: 'Low writing preferred', confidence: 0.82, source: 'rule' },
          ],
          warnings: [
            { kind: 'writing_evidence_incomplete', message: 'Essay and writing workload evidence is incomplete for many courses.', confidence: 0.78 },
          ],
          retrievalLanes: ['requirement', 'structured_section', 'student_language_alias', 'workload_evidence'],
          relaxationPlan: [],
          needsStudentProfile: false,
          confidence: 0.82,
        },
      },
    });

    expect(dto.explanation?.matchedChips).toEqual(['Online preferred', 'Low writing preferred']);
    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining([
      expect.stringContaining('GenEd'),
      'Student-language alias match',
    ]));
    expect(dto.explanation?.watchOut).toEqual(expect.arrayContaining([
      'Essay and writing workload evidence is incomplete for many courses.',
      'Subjective preferences are not fully backed by assignment-level evidence for this course.',
    ]));
    expect(dto.explanation?.confidence.label).toBe('medium');
  });

  it('labels generic GenEd filters as Any GenEd in result evidence', () => {
    const dto = searchResultToCourseDto(searchResult({ laneMatches: ['requirement'] }), {
      rawQuery: 'easy cs gened',
      hints: [],
      plan: {
        filters: {
          subject: 'CS',
          difficulty: 'easy',
          gened_any: ['HUM', 'NAT', 'SBS', 'CS', 'QR', 'QR1', 'QR2', 'NW', 'US', 'WCC', 'ACP'],
        },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining(['Any GenEd: QR']));
    expect(dto.match_evidence?.find(item => item.kind === 'gened')).toMatchObject({
      label: 'Any GenEd',
      value: 'QR',
      weight: 'hard',
    });
  });

  it('does not claim requirement evidence for unmapped courses', () => {
    const dto = searchResultToCourseDto(searchResult({
      course: { ...course, gened: null },
      laneMatches: ['requirement'],
    }), {
      rawQuery: 'counts for something',
      hints: [],
      plan: {
        filters: {},
        keywordQuery: '',
        semanticQuery: '',
        rescue: {
          queryTypes: ['requirement'],
          negativeTerms: [],
          topicTerms: [],
          expandedTerms: [],
          assumptions: [],
          warnings: [],
          retrievalLanes: ['requirement'],
          relaxationPlan: [],
          needsStudentProfile: false,
          confidence: 0.74,
        },
      },
    });

    expect(dto.match_evidence?.map(item => item.label)).not.toContain('Requirement lane match');
    expect(dto.match_evidence?.some(item => item.kind === 'gened')).toBe(false);
  });

  it('keeps warning construction narrow and non-secret', () => {
    expect(buildResultWarnings(searchResult())).toEqual([]);
    expect(buildResultWarnings(searchResult({ historical: true }))[0].message).toBe('Historical term result');
  });

  it('does not surface zero-valued RMP rows as ratings', () => {
    const dto = toCourseDto({
      ...course,
      primary_instructor_rmp: 0,
    });
    const link = toInstructorLinkDto({
      instructor_name: 'Fox, E',
      rmp_rating: 0,
      rmp_difficulty: 0,
      rmp_id: 'fox',
      num_ratings: 0,
    });

    expect(dto.primary_instructor_rmp).toBeNull();
    expect(link).toMatchObject({
      instructor_name: 'Fox, E',
      rmp_rating: null,
      rmp_difficulty: null,
      rmp_id: 'fox',
      rmp_url: null,
      rmp_search_url: 'https://www.ratemyprofessors.com/search/professors/1112?q=Fox%2C%20E',
      num_ratings: 0,
    });
  });

  it('surfaces public direct RMP links only for numeric professor IDs', () => {
    const link = toInstructorLinkDto({
      instructor_name: 'Fagen-Ulmschneider, W',
      rmp_rating: 4.9,
      rmp_difficulty: 3.4,
      rmp_id: '85515',
      num_ratings: 120,
    });

    expect(link.rmp_url).toBe('https://www.ratemyprofessors.com/professor/85515');
    expect(link.rmp_search_url).toBe('https://www.ratemyprofessors.com/search/professors/1112?q=Fagen-Ulmschneider%2C%20W');
  });
});
